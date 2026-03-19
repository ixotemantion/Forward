const RESOURCE_SITES = `
如意,https://cj.rycjapi.com/api.php/provide/vod/at/json/
量子,https://cj.lziapi.com/api.php/provide/vod/at/json/
爱奇,https://iqiyizyapi.com/api.php/provide/vod/
卧龙,https://wolongzyw.com/api.php/provide/vod/
最大,https://api.zuidapi.com/api.php/provide/vod/
暴风,https://bfzyapi.com/api.php/provide/vod/
极速,https://jszyapi.com/api.php/provide/vod/
无尽,https://api.wujinapi.com/api.php/provide/vod/
天堂,http://caiji.dyttzyapi.com/api.php/provide/vod/
如意,https://cj.rycjapi.com/api.php/provide/vod/
红牛,https://www.hongniuzy2.com/api.php/provide/vod/
爱坤,https://ikunzyapi.com/api.php/provide/vod/
优酷,https://api.ukuapi.com/api.php/provide/vod/
虎牙,https://www.huyaapi.com/api.php/provide/vod/
新浪,http://api.xinlangapi.com/xinlangapi.php/provide/vod/
鲸鱼,https://jyzyapi.com/provide/vod/
爱蛋,https://lovedan.net/api.php/provide/vod/
飘零,https://p2100.net/api.php/provide/vod/
`;

const CHINESE_NUM_MAP = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10
};

// 扩充部分序号的映射
const PART_ORDER_MAP = {
  '': 0, '前': 1, '前篇': 1, '上': 1, '上部': 1, '上集': 1, '上部分': 1, '1': 1, '一': 1, 'A': 1, 'a': 1,
  '中': 2, '中部': 2, '中集': 2, '中部分': 2, '2': 2, '二': 2, 'B': 2, 'b': 2,
  '后': 3, '后篇': 3, '下': 3, '下部': 3, '下集': 3, '下部分': 3, '3': 3, '三': 3, 'C': 3, 'c': 3,
  '本': 4, '全': 4, '完整': 4, '4': 4, '四': 4,
  '五': 5, '5': 5, '五部': 5
};

// 站点健康度评估常量
const SITE_HEALTH_KEY = 'vod_site_health_stats';
const MAX_HEALTH_HISTORY = 20; // 每个站点最多记录的历史记录数
const HEALTH_TIMEOUT_WEIGHT = 2.0; // 超时惩罚权重
const HEALTH_SUCCESS_BONUS = 0.1; // 成功奖励
const INITIAL_HEALTH_SCORE = 0.7; // 初始健康度分数

WidgetMetadata = {
  id: "VOD_Stream",
  title: "VOD Stream",
  icon: "无",
  version: "1.6.1", // 版本号升级
  requiredVersion: "0.0.1",
  description: "获取聚合VOD影视资源，智能分组，连接质量排序",
  author: "MoYan",
  site: "无",
  globalParams: [
    {
      name: "multiSource",
      title: "是否启用聚合搜索",
      type: "enumeration",
      enumOptions: [
        { title: "启用", value: "enabled" },
        { title: "禁用", value: "disabled" }
      ]
    },
    {
      name: "enableHealthSort",
      title: "是否启用连接质量排序",
      type: "enumeration",
      enumOptions: [
        { title: "启用", value: "enabled" },
        { title: "禁用", value: "disabled" }
      ],
      value: "enabled"
    },
    {
      name: "VodData",
      title: "JSON或CSV格式的源配置",
      type: "input",
      value: RESOURCE_SITES
    }
  ],
  modules: [
    {
      id: "loadResource",
      title: "加载资源",
      functionName: "loadResource",
      type: "stream",
      params: [],
    }
  ],
};

// --- 辅助工具函数 ---
const isM3U8Url = (url) => url?.toLowerCase().includes('m3u8') || false;

function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  const set1 = new Set(str1.replace(/\s/g, ''));
  const set2 = new Set(str2.replace(/\s/g, ''));
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return union.size === 0 ? 1 : intersection.size / union.size;
}

/**
 * 站点健康度管理模块
 */
class SiteHealthManager {
  constructor() {
    this.healthStats = {};
    this.loadHealthStats();
  }
  
  loadHealthStats() {
    try {
      const stats = Widget.storage.get(SITE_HEALTH_KEY);
      if (stats && typeof stats === 'object') {
        this.healthStats = stats;
      }
    } catch (e) {
      this.healthStats = {};
    }
  }
  
  saveHealthStats() {
    try {
      Widget.storage.set(SITE_HEALTH_KEY, this.healthStats);
    } catch (e) {
      // 忽略存储错误
    }
  }
  
  /**
   * 记录站点请求结果
   * @param {string} siteTitle 站点标题
   * @param {number} responseTime 响应时间(ms)
   * @param {boolean} success 是否成功
   * @param {number} dataSize 数据大小（字节数）
   */
  recordRequest(siteTitle, responseTime, success, dataSize = 0) {
    if (!siteTitle) return;
    
    if (!this.healthStats[siteTitle]) {
      this.healthStats[siteTitle] = {
        totalRequests: 0,
        successRequests: 0,
        totalResponseTime: 0,
        totalDataSize: 0,
        recentHistory: [],
        healthScore: INITIAL_HEALTH_SCORE,
        lastUpdated: Date.now()
      };
    }
    
    const stats = this.healthStats[siteTitle];
    stats.totalRequests++;
    
    if (success) {
      stats.successRequests++;
      stats.totalResponseTime += responseTime;
      stats.totalDataSize += dataSize;
      
      // 记录到历史记录
      stats.recentHistory.push({
        timestamp: Date.now(),
        responseTime,
        success: true,
        dataSize
      });
    } else {
      // 失败记录
      stats.recentHistory.push({
        timestamp: Date.now(),
        responseTime,
        success: false,
        dataSize: 0
      });
    }
    
    // 保持历史记录不超过最大数量
    if (stats.recentHistory.length > MAX_HEALTH_HISTORY) {
      stats.recentHistory = stats.recentHistory.slice(-MAX_HEALTH_HISTORY);
    }
    
    // 计算健康度分数
    this.calculateHealthScore(siteTitle);
    stats.lastUpdated = Date.now();
    
    this.saveHealthStats();
  }
  
  /**
   * 计算站点健康度分数
   */
  calculateHealthScore(siteTitle) {
    const stats = this.healthStats[siteTitle];
    if (!stats || stats.totalRequests === 0) {
      stats.healthScore = INITIAL_HEALTH_SCORE;
      return;
    }
    
    const successRate = stats.successRequests / stats.totalRequests;
    const avgResponseTime = stats.successRequests > 0 
      ? stats.totalResponseTime / stats.successRequests 
      : 10000; // 默认10秒
    
    // 计算最近记录的成功率（加权）
    let recentSuccessRate = 0;
    let recentCount = 0;
    const now = Date.now();
    const oneHourAgo = now - 3600000; // 1小时内
    
    stats.recentHistory.forEach(record => {
      if (record.timestamp > oneHourAgo) {
        recentCount++;
        if (record.success) recentSuccessRate += 1;
      }
    });
    
    recentSuccessRate = recentCount > 0 ? recentSuccessRate / recentCount : successRate;
    
    // 响应时间评分（响应时间越短，分数越高）
    const responseTimeScore = Math.max(0, Math.min(1, 1 - (avgResponseTime / 5000)));
    
    // 综合评分
    const weightRecent = 0.6; // 近期成功率权重
    const weightOverall = 0.3; // 总体成功率权重
    const weightResponse = 0.1; // 响应时间权重
    
    stats.healthScore = 
      (recentSuccessRate * weightRecent) +
      (successRate * weightOverall) +
      (responseTimeScore * weightResponse);
    
    // 确保分数在0-1之间
    stats.healthScore = Math.max(0, Math.min(1, stats.healthScore));
  }
  
  /**
   * 获取站点健康度分数
   */
  getHealthScore(siteTitle) {
    if (!this.healthStats[siteTitle]) {
      return INITIAL_HEALTH_SCORE;
    }
    
    // 如果很久没更新，分数衰减
    const stats = this.healthStats[siteTitle];
    const hoursSinceUpdate = (Date.now() - stats.lastUpdated) / 3600000;
    if (hoursSinceUpdate > 24) {
      // 超过24小时，分数衰减
      return stats.healthScore * Math.max(0, 1 - (hoursSinceUpdate - 24) * 0.1);
    }
    
    return stats.healthScore;
  }
  
  /**
   * 获取所有站点的健康度排名
   */
  getSiteRankings() {
    const rankings = [];
    
    for (const [siteTitle, stats] of Object.entries(this.healthStats)) {
      rankings.push({
        siteTitle,
        healthScore: this.getHealthScore(siteTitle),
        successRate: stats.totalRequests > 0 ? stats.successRequests / stats.totalRequests : 0,
        avgResponseTime: stats.successRequests > 0 ? stats.totalResponseTime / stats.successRequests : 0,
        totalRequests: stats.totalRequests
      });
    }
    
    // 按健康度分数降序排序
    rankings.sort((a, b) => b.healthScore - a.healthScore);
    
    return rankings;
  }
}

// 创建全局健康度管理器实例
const siteHealthManager = new SiteHealthManager();

/**
 * 增强版：提取并判定视频特性标签，核心是准确分辨"正片"
 * 优化点：扩大非正片关键词库，并优化判断优先级，以提高辨别准确性。
 */
function extractFeatureTag(vod_remarks, epName, quality = '') {
  if (!vod_remarks) vod_remarks = '';
  if (!epName) epName = '';
  if (!quality) quality = '';
  
  const remark = vod_remarks.toLowerCase();
  const episode = epName.toLowerCase();
  const qual = quality.toLowerCase();
  
  // 优先级1: 识别"非正片"特征 (抢先版、枪版、TC、尝鲜版等)
  const nonTheatricalKeywords = [
    'tc', 'tc版', '抢先版', '枪版', '尝鲜版', '非正式版',
    'hdts', 'hdts版', 'hdtc', 'hdtc版', 'ts', 'ts版',
    'cam', 'cam版', 'scr', 'scr版', 'dvdscr', 'web-dl',
    '低清', '高清tc', '高清抢先', '内部版', '预映版'
  ];
  
  const allText = `${remark} ${episode} ${qual}`;
  for (const keyword of nonTheatricalKeywords) {
    if (allText.includes(keyword)) {
      if (qual.includes('tc') || qual.includes('抢先') || remark.includes('tc') || remark.includes('抢先')) {
        return '抢先版';
      }
      return '非正片';
    }
  }
  
  // 优先级2: 识别特殊内容类型 (纯享、番外、花絮)
  if (remark.includes('纯享') || episode.includes('纯享')) {
    return '纯享';
  }
  if (remark.includes('番外') || episode.includes('番外')) {
    return '番外';
  }
  if (remark.includes('花絮') || episode.includes('花絮')) {
    return '花絮';
  }
  if (remark.includes('特辑') || episode.includes('特辑')) {
    return '特辑';
  }
  
  // 优先级3: 默认为"正片"
  return '正片';
}

function extractSeasonInfo(seriesName) {
  if (!seriesName) return { baseName: seriesName, seasonNumber: 1 };
  
  let cleanedName = seriesName;
  cleanedName = cleanedName.replace(/[\(\[（【][^\)\]）】]*[\)\]）】]/g, '');
  
  let baseName = cleanedName;
  let seasonNumber = 1;
  
  const chineseMatch = cleanedName.match(/第([一二三四五六七八九十\d]+)[季部]/);
  if (chineseMatch) {
    const val = chineseMatch[1];
    seasonNumber = CHINESE_NUM_MAP[val] || parseInt(val) || 1;
    baseName = cleanedName.replace(/第[一二三四五六七八九十\d]+[季部]/, '').trim();
  } else {
    const digitMatch = cleanedName.match(/(.+?)(?:[ _\-]?)(\d{1,4})$/);
    if (digitMatch) {
      const possibleBase = digitMatch[1].trim();
      const possibleSeason = parseInt(digitMatch[2]);
      if (possibleBase && possibleSeason > 0) {
        baseName = possibleBase;
        seasonNumber = possibleSeason;
      }
    }
  }
  
  baseName = baseName
    .replace(/[《》【】\[\]\s\-~!@#$%^&*()_+=<>?，。、]/g, '')
    .trim();
    
  return { baseName, seasonNumber };
}

function parseVarietyEpisode(epName) {
  if (!epName) return null;
  const epNameClean = epName.trim();

  if (epNameClean.includes('先导')) {
    return { seasonNum: 0, partOrder: 0, rawName: epNameClean, type: 'pilot' };
  }
  let specialMatch = epNameClean.match(/(?:特别篇|加更)[\s\-]*(\d+)/);
  if (specialMatch) {
    const specialNum = parseInt(specialMatch[1]);
    return { seasonNum: 1000 + specialNum, partOrder: 0, rawName: epNameClean, type: 'special' };
  }
  let match = epNameClean.match(/第\s*(\d+)\s*[期集][\s\-\(（]*([上下中一二三四五六七八九十\d前半后本]*)[\s\)）\-]*/);
  if (match) {
    const seasonNum = parseInt(match[1]);
    let partKey = match[2]?.trim() || '';
    const partOrder = PART_ORDER_MAP[partKey] !== undefined ? PART_ORDER_MAP[partKey] : (parseInt(partKey) || 0);
    return { seasonNum, partOrder, rawName: epNameClean, type: 'standard' };
  }
  match = epNameClean.match(/[EePp][\s\-]*(\d+)/i);
  if (match) {
    const seasonNum = parseInt(match[1]);
    return { seasonNum, partOrder: 0, rawName: epNameClean, type: 'ep' };
  }
  const digitMatch = epNameClean.match(/(\d+)/);
  if (digitMatch) {
    const seasonNum = parseInt(digitMatch[1]);
    return { seasonNum, partOrder: 0, rawName: epNameClean, type: 'fallback_digit' };
  }
  return { seasonNum: 0, partOrder: 0, rawName: epNameClean, type: 'unknown' };
}

function extractPlayInfoForCache(item, siteTitle, type) {
  const { vod_name, vod_play_url, vod_play_from, vod_remarks = '' } = item;
  if (!vod_name || !vod_play_url) return [];

  const playSources = vod_play_url.replace(/#+$/, '').split('$$$');
  const sourceNames = (vod_play_from || '').split('$$$');
  
  return playSources.flatMap((playSource, i) => {
    const sourceName = sourceNames[i] || '默认源';
    const isTV = playSource.includes('#');
    const results = [];

    if (type === 'tv' && isTV) {
      const episodes = playSource.split('#').filter(Boolean);
      
      episodes.forEach(ep => {
        const [rawEpName, url] = ep.split('$');
        if (url && isM3U8Url(url)) {
          const epNameClean = rawEpName.trim();
          let episodeInfoForSort = null;
          
          const parsedInfo = parseVarietyEpisode(epNameClean);
          if (parsedInfo) {
            episodeInfoForSort = { 
              seasonNum: parsedInfo.seasonNum, 
              partOrder: parsedInfo.partOrder, 
              rawName: parsedInfo.rawName,
              type: parsedInfo.type
            };
          } else {
            episodeInfoForSort = { seasonNum: 0, partOrder: 0, rawName: epNameClean, type: 'parse_failed' };
          }

          const featureTag = extractFeatureTag(vod_remarks, epNameClean);
          
          // 获取站点健康度分数
          const healthScore = siteHealthManager.getHealthScore(siteTitle);
          
          results.push({
            name: siteTitle,
            description: `${vod_name} - ${rawEpName}${vod_remarks ? ' - ' + vod_remarks : ''} - [${sourceName}]`,
            url: url.trim(),
            _epInfo: episodeInfoForSort,
            _rawEpName: epNameClean,
            _originalEpForFilter: parsedInfo ? parsedInfo.seasonNum : 0,
            _vodName: vod_name,
            _featureTag: featureTag,
            _sourceName: sourceName,
            _healthScore: healthScore, // 添加健康度分数
            _siteTitle: siteTitle // 保存站点标题用于健康度排序
          });
        }
      });
    } else if (type === 'movie' && !isTV) {
      const firstM3U8 = playSource.split('#').find(v => isM3U8Url(v.split('$')[1]));
      if (firstM3U8) {
        const [quality, url] = firstM3U8.split('$');
        const featureTag = extractFeatureTag(vod_remarks, '', quality);
        
        // 获取站点健康度分数
        const healthScore = siteHealthManager.getHealthScore(siteTitle);
        
        results.push({
          name: siteTitle,
          description: `${vod_name} - ${featureTag} - [${sourceName}]`,
          url: url.trim(),
          _featureTag: featureTag,
          _healthScore: healthScore, // 添加健康度分数
          _siteTitle: siteTitle // 保存站点标题用于健康度排序
        });
      }
    }
    return results;
  });
}

function parseResourceSites(VodData) {
  const parseLine = (line) => {
    const [title, value] = line.split(',').map(s => s.trim());
    if (title && value?.startsWith('http')) {
      return { title, value: value.endsWith('/') ? value : value + '/' };
    }
    return null;
  };
  try {
    const trimmed = VodData?.trim() || "";
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      return JSON.parse(trimmed).map(s => ({ title: s.title || s.name, value: s.url || s.value })).filter(s => s.title && s.value);
    }
    return trimmed.split('\n').map(parseLine).filter(Boolean);
  } catch (e) {
    return RESOURCE_SITES.trim().split('\n').map(parseLine).filter(Boolean);
  }
}

/**
 * 对剧集进行连续编号
 * 最新编号规则：
 * 1. 所有 seasonNum 为 0 的剧集（包括先导片、无期数的"全部"等）固定为0
 * 2. 其他剧集：每一期的"完整版"和"上集"共享同一个编号
 * 3. 其他剧集："中集"、"下集"等独立分配新的连续编号
 */
function assignContinuousEpisodeNumbers(resources) {
  console.log('[assignContinuousEpisodeNumbers] 开始连续编号，输入资源数:', resources.length);
  
  const tvResources = resources.filter(r => r._epInfo);
  const nonTvResources = resources.filter(r => !r._epInfo);
  
  if (tvResources.length === 0) {
    return resources;
  }
  
  // 1. 排序：按 seasonNum 和 partOrder 排序
  tvResources.sort((a, b) => {
    const aInfo = a._epInfo;
    const bInfo = b._epInfo;
    if (aInfo.seasonNum !== bInfo.seasonNum) {
      return aInfo.seasonNum - bInfo.seasonNum;
    }
    if (aInfo.partOrder !== bInfo.partOrder) {
      return aInfo.partOrder - bInfo.partOrder;
    }
    return (aInfo.rawName || '').localeCompare(bInfo.rawName || '');
  });
  
  // 2. 连续编号
  let nextAvailableNumber = 1;
  const episodeNumberMap = new Map();
  const renumberedResources = [];
  
  // 分离"期数为0"和其他剧集
  const zeroSeasonResources = [];
  const otherResources = [];
  tvResources.forEach(res => {
    if (res._epInfo && res._epInfo.seasonNum === 0) {
      zeroSeasonResources.push(res);
    } else {
      otherResources.push(res);
    }
  });
  
  // 为所有"期数为0"的剧集分配编号0
  zeroSeasonResources.forEach(res => {
    const info = res._epInfo;
    const uniqueKey = `0_${info.partOrder}_${info.type}`;
    episodeNumberMap.set(uniqueKey, 0);
    renumberedResources.push({ res, episodeNumber: 0 });
  });
  
  // 为其他剧集（期数>=1）分配连续编号
  otherResources.forEach(res => {
    const info = res._epInfo;
    
    // 核心：生成合并键
    let mergeKey = '';
    if (info.partOrder === 0 || info.partOrder === 1) {
      // 完整版 和 "上" 共享同一个键
      mergeKey = `${info.seasonNum}_0or1`;
    } else {
      // "中"、"下"等部分获得独立的键
      mergeKey = `${info.seasonNum}_${info.partOrder}`;
    }
    
    let episodeNumber;
    if (episodeNumberMap.has(mergeKey)) {
      episodeNumber = episodeNumberMap.get(mergeKey);
    } else {
      episodeNumber = nextAvailableNumber;
      episodeNumberMap.set(mergeKey, episodeNumber);
      nextAvailableNumber++;
    }
    renumberedResources.push({ res, episodeNumber });
  });
  
  // 3. 按编号排序
  renumberedResources.sort((a, b) => a.episodeNumber - b.episodeNumber);
  
  // 4. 构建最终描述（格式：影片名 第N集 原始剧集信息 - 备注 - [数据源名称]）
  const finalResources = renumberedResources.map(({ res, episodeNumber }) => {
    const info = res._epInfo;
    
    const vodName = res._vodName || '';
    let cleanVodName = vodName
      .replace(/\([^)]*\)/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\s+/g, '')
      .trim();
    
    // 根据部分信息添加后缀
    let partSuffix = '';
    if (info.partOrder > 0) {
      const partMap = { 1: '上', 2: '中', 3: '下', 4: '全' };
      partSuffix = `-${partMap[info.partOrder] || info.partOrder}`;
    }
    
    // 最终描述格式：影片名 第N集 原始剧集信息 - 备注 - [数据源名称]
    const newDescription = `${cleanVodName} 第${episodeNumber}集${partSuffix} ${info.rawName} - ${res._featureTag} - [${res._sourceName}]`;
    
    return {
      ...res,
      _ep: episodeNumber,
      description: newDescription
    };
  });
  
  return [...finalResources, ...nonTvResources];
}

/**
 * 按连接质量排序资源
 * 在正片内部，将连接最快、最健康的站点资源排在最前面
 */
function sortByConnectionHealth(resources, enableHealthSort) {
  if (!enableHealthSort || resources.length <= 1) {
    return resources;
  }
  
  console.log('[sortByConnectionHealth] 开始按连接质量排序，资源数:', resources.length);
  
  // 先按原有规则分组
  const groupedResources = {};
  
  resources.forEach(resource => {
    const key = `${resource._vodName || 'unknown'}_${resource._ep || 0}`;
    if (!groupedResources[key]) {
      groupedResources[key] = [];
    }
    groupedResources[key].push(resource);
  });
  
  // 对每个组进行排序
  const sortedResources = [];
  
  Object.values(groupedResources).forEach(group => {
    // 在组内按健康度分数降序排序（分数高的排前面）
    group.sort((a, b) => {
      const aScore = a._healthScore || 0;
      const bScore = b._healthScore || 0;
      
      if (bScore !== aScore) {
        return bScore - aScore; // 降序排序
      }
      
      // 如果健康度分数相同，则按原有顺序保持稳定
      return 0;
    });
    
    sortedResources.push(...group);
  });
  
  return sortedResources;
}

async function loadResource(params) {
  const { seriesName, type = 'tv', season, episode, multiSource, VodData, enableHealthSort = "enabled" } = params;
  if (multiSource !== "enabled" || !seriesName) return [];

  const resourceSites = parseResourceSites(VodData);
  const { baseName, seasonNumber } = extractSeasonInfo(seriesName);
  const targetSeason = season ? parseInt(season) : seasonNumber;
  const targetEpisode = episode ? parseInt(episode) : null;

  // --- 针对电影类型优化搜索关键词提取 ---
  let finalSearchKey = baseName; // 最终用于搜索的片名
  let searchHasNumber = false;   // 标记搜索词是否以数字结尾
  let sequelNumberSuffix = null; // 搜索词结尾的数字（如果有）

  if (type === 'movie') {
    // 1. 提取"片名+数字"组合
    // 匹配以字母、汉字、数字、空格开头，直到遇到非字母数字字符（如冒号、空格、标点等）为止
    const movieNameWithNumberMatch = seriesName.match(/^([\u4e00-\u9fa5a-zA-Z0-9\s]+\d+)/);
    if (movieNameWithNumberMatch) {
      finalSearchKey = movieNameWithNumberMatch[1].trim();
      // 检查提取出的片名是否以数字结尾
      const numberMatch = finalSearchKey.match(/(\d+)$/);
      if (numberMatch) {
        searchHasNumber = true;
        sequelNumberSuffix = numberMatch[1];
      }
    }
  }
  // --- 优化结束 ---

  const cacheKey = `vod_cache_${finalSearchKey}_s${targetSeason}_${type}`;
  let allResources = [];
  
  try {
    const cached = Widget.storage.get(cacheKey);
    if (cached && Array.isArray(cached)) {
      allResources = cached;
    }
  } catch (e) {}

  if (allResources.length === 0) {
    const fetchTasks = resourceSites.map(async (site) => {
      const startTime = Date.now();
      let isSuccess = false;
      let dataSize = 0;
      
      try {
        const response = await Widget.http.get(site.value, {
          params: { ac: "detail", wd: finalSearchKey.trim() }, // 使用优化后的finalSearchKey
          timeout: 10000
        });
        
        const endTime = Date.now();
        isSuccess = true;
        dataSize = JSON.stringify(response.data).length;
        
        // 记录站点健康度
        siteHealthManager.recordRequest(site.title, endTime - startTime, true, dataSize);
        
        const list = response?.data?.list;
        
        if (!Array.isArray(list)) return [];

        return list.flatMap(item => {
          const itemInfo = extractSeasonInfo(item.vod_name);
          const SIMILARITY_THRESHOLD = 0.8; // 提高相似度阈值，从0.6提高到0.8
          
          const nameSimilarity = calculateSimilarity(itemInfo.baseName, finalSearchKey);
          const originalContains = item.vod_name.includes(finalSearchKey);
          const seasonMatch = Math.abs(itemInfo.seasonNumber - targetSeason) <= 1;

          if ((nameSimilarity >= SIMILARITY_THRESHOLD || originalContains) && seasonMatch) {
            // --- 针对电影类型的续集过滤逻辑优化 ---
            if (type === 'movie') {
              const itemName = item.vod_name;
              
              // 移除干扰字符，便于后续匹配
              const cleanSearchKey = finalSearchKey.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
              const cleanItemName = itemName.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
              
              // 判断电影名是否以数字结尾
              const itemEndsWithNumber = /\d+$/.test(cleanItemName);
              const itemNumberSuffix = itemEndsWithNumber ? cleanItemName.match(/(\d+)$/)?.[1] : null;
              
              // 获取电影名的基础部分（移除结尾数字）
              const itemBase = itemEndsWithNumber ? cleanItemName.replace(/\d+$/, '').trim() : cleanItemName;
              const searchBase = searchHasNumber ? cleanSearchKey.replace(/\d+$/, '').trim() : cleanSearchKey;
              
              // 核心过滤规则
              let shouldInclude = true;
              
              if (!searchHasNumber) {
                // 情况A：用户搜索"xxxx"（无数字），需要排除"xxxx2"、"xxxx3"等
                // 方法1：检测电影名是否包含"搜索词+数字"模式（宽松匹配）
                const sequelPattern = new RegExp(`${searchBase}\\s*[\\d一二三四五六七八九十]+`);
                
                if (sequelPattern.test(cleanItemName)) {
                  shouldInclude = false;
                }
                // 方法2：检测常见续集关键词
                else {
                  const sequelKeywords = [
                    '2', '3', '4', '5', '6', '7', '8', '9', '10',
                    'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ',
                    '续集', '续', '第二部', '第三部', '前传', '后传',
                    '：', '之', '篇', '章'
                  ];
                  
                  const hasSequelIndicator = sequelKeywords.some(keyword => 
                    itemName.includes(keyword) && nameSimilarity >= 0.7
                  );
                  
                  if (hasSequelIndicator) {
                    shouldInclude = false;
                  }
                  // 方法3：保留原有的结尾数字检测作为补充
                  else if (itemEndsWithNumber && itemBase && calculateSimilarity(finalSearchKey, itemBase) >= SIMILARITY_THRESHOLD) {
                    shouldInclude = false;
                  }
                }
              } else {
                // 情况B：用户搜索"xxxx2"，我们希望精确匹配"xxxx2"
                // 比较基础名相似度
                const baseNameSimilar = calculateSimilarity(searchBase, itemBase) >= SIMILARITY_THRESHOLD;
                if (baseNameSimilar) {
                  // 基础名相似，但数字不同，可能是另一部续集，排除
                  if (sequelNumberSuffix !== itemNumberSuffix) {
                    shouldInclude = false;
                  }
                } else {
                  // 基础名不相似，但整体包含关系可能误判，额外检查
                  // 例如搜索"阿凡达2"，不希望包含"阿凡达"
                  if (itemBase && finalSearchKey.includes(itemBase) && !itemEndsWithNumber) {
                    // 如果搜索词包含电影基础名，但电影名没有数字，可能是原片，排除
                    shouldInclude = false;
                  }
                }
              }
              
              if (!shouldInclude) {
                console.log(`[续集过滤] 排除 ${itemName}，搜索词: ${finalSearchKey}`);
                return []; // 排除此电影
              }
            }
            // --- 续集过滤逻辑结束 ---
            
            return extractPlayInfoForCache(item, site.title, type);
          }
          return [];
        });
      } catch (error) {
        const endTime = Date.now();
        // 记录失败请求
        siteHealthManager.recordRequest(site.title, endTime - startTime, false, 0);
        return [];
      }
    });

    const results = await Promise.all(fetchTasks);
    const merged = results.flat();

    const urlSet = new Set();
    allResources = merged.filter(res => {
      if (urlSet.has(res.url)) {
        return false;
      }
      urlSet.add(res.url);
      return true;
    });
    
    if (type === 'tv') {
      allResources = assignContinuousEpisodeNumbers(allResources);
    }

    if (allResources.length > 0) {
      try { 
        Widget.storage.set(cacheKey, allResources, 10800);
      } catch (e) {}
    }
  }

  if (type === 'tv' && targetEpisode !== null) {
    allResources = allResources.filter(res => {
      if (res._ep !== undefined && res._ep !== null) {
        return res._ep === targetEpisode;
      }
      return false;
    });
  }

  // --- 最终排序，确保"正片"在前 ---
  allResources.sort((a, b) => {
    const aIsTheatrical = a._featureTag === '正片';
    const bIsTheatrical = b._featureTag === '正片';
    
    // 第一优先级：正片在前
    if (aIsTheatrical && !bIsTheatrical) {
      return -1;
    }
    if (!aIsTheatrical && bIsTheatrical) {
      return 1;
    }
    
    // 第二优先级：如果都是正片或都不是，则按剧集编号排序
    if (a._ep !== undefined && b._ep !== undefined) {
      if (a._ep !== b._ep) {
        return a._ep - b._ep;
      }
    }
    
    // 第三优先级：如果启用了连接质量排序，则按健康度分数排序
    if (enableHealthSort === "enabled") {
      const aHealthScore = a._healthScore || 0;
      const bHealthScore = b._healthScore || 0;
      
      if (Math.abs(aHealthScore - bHealthScore) > 0.001) {
        return bHealthScore - aHealthScore; // 降序排序，健康度高的在前
      }
    }
    
    // 第四优先级：按描述字符串稳定排序
    return (a.description || '').localeCompare(b.description || '');
  });
  
  // 如果需要，对正片内部进行额外的连接质量排序
  if (enableHealthSort === "enabled") {
    allResources = sortByConnectionHealth(allResources, true);
  }

  return allResources;
}
