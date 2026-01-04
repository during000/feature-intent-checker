import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FunctionRecord {
  id: number;
  source_dir: string;
  source_file: string;
  row_number: number;
  level_1: string | null;
  function_point: string | null;
  sub_function: string | null;
  search_text: string;
  intent_text: string | null;
}

interface SearchResult extends FunctionRecord {
  intent_similarity: number;
  text_similarity: number;
  is_duplicate: boolean;
}

// 常见应用名（必须保留）
const APP_NAMES = [
  '全民K歌', '抖音', '微信', '支付宝', '淘宝', '京东', '美团', '饿了么',
  '哔哩哔哩', 'B站', '快手', '小红书', '知乎', '百度', '网易云音乐',
  'QQ', '钉钉', '企业微信', '拼多多', '闲鱼', '高德地图', '百度地图',
  '携程', '飞猪', '去哪儿', '12306', '滴滴', '花小猪', '曹操出行'
];

// 动词归一化映射表
const ACTION_MAP: { [key: string]: string } = {
  '打开': '打开', '进入': '打开', '启动': '打开', '开启': '打开',
  '搜索': '搜索', '查找': '搜索', '搜一下': '搜索', '找': '搜索',
  '播放': '播放', '听': '播放', '观看': '播放', '看': '播放',
  '点赞': '点赞', '赞': '点赞', '喜欢': '点赞',
  '评论': '评论', '留言': '评论',
  '关注': '关注', '订阅': '关注',
  '分享': '分享', '转发': '分享',
  '收藏': '收藏', '保存': '收藏',
  '删除': '删除', '移除': '删除',
  '添加': '添加', '新增': '添加', '创建': '添加',
  '编辑': '编辑', '修改': '编辑',
  '查看': '查看', '浏览': '查看',
  '下载': '下载', '上传': '上传', '发布': '上传',
  '登录': '登录', '退出': '退出',
};

// 常见内容参数关键词（应该剥离）
const CONTENT_KEYWORDS = [
  '山楂树之恋', '周杰伦', '晴天', '七里香', '快乐', '美食', '旅游',
  '搞笑', '音乐', '视频', '图片', '文章', '新闻'
];

// 提取应用名
function extractAppName(text: string): string | null {
  for (const app of APP_NAMES) {
    if (text.includes(app)) {
      return app;
    }
  }
  return null;
}

// 提取并归一化动词
function extractActions(text: string): string[] {
  const actions: string[] = [];
  for (const [key, value] of Object.entries(ACTION_MAP)) {
    if (text.includes(key) && !actions.includes(value)) {
      actions.push(value);
    }
  }
  return actions;
}

// 剥离内容参数
function removeContentParams(text: string): string {
  let cleaned = text;
  
  // 移除常见内容关键词
  for (const keyword of CONTENT_KEYWORDS) {
    cleaned = cleaned.replace(keyword, '');
  }
  
  // 移除引号/书名号内的内容
  cleaned = cleaned.replace(/[《「『"'](.*?)[》」』"']/g, '');
  
  // 移除明显的专有名词（3-8个连续中文，不在动词表中）
  const words = cleaned.split(/\s+/);
  const filtered = words.filter(word => {
    // 保留动词和应用名
    if (Object.values(ACTION_MAP).includes(word)) return true;
    if (APP_NAMES.includes(word)) return true;
    // 移除长度3-8的可能是内容参数
    if (word.length >= 3 && word.length <= 8 && /^[\u4e00-\u9fa5]+$/.test(word)) {
      return !CONTENT_KEYWORDS.includes(word);
    }
    return true;
  });
  
  return filtered.join(' ');
}

// 智能归一化意图
function normalizeIntent(text: string): string {
  if (!text) return '';
  
  const parts: string[] = [];
  
  // 1. 提取应用名（最重要的上下文）
  const appName = extractAppName(text);
  if (appName) {
    parts.push(appName);
  }
  
  // 2. 提取并归一化动词
  const actions = extractActions(text);
  parts.push(...actions);
  
  // 3. 如果没有提取到任何有效信息，保留原文的关键部分
  if (parts.length === 0) {
    // 移除参数后保留
    const cleaned = removeContentParams(text);
    return cleaned.substring(0, 20).trim();
  }
  
  return parts.join(' ').trim();
}

// 计算意图相似度（综合考虑）
function computeIntentSimilarity(query: string, record: string): number {
  if (!query || !record) return 0;
  
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  const recordWords = record.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  
  if (queryWords.length === 0 || recordWords.length === 0) return 0;
  
  const querySet = new Set(queryWords);
  const recordSet = new Set(recordWords);
  
  // 检查应用名是否相同
  let appMatch = true;
  const queryApp = APP_NAMES.find(app => query.includes(app));
  const recordApp = APP_NAMES.find(app => record.includes(app));
  
  if (queryApp && recordApp && queryApp !== recordApp) {
    // 应用名不同，相似度大打折扣
    appMatch = false;
  }
  
  // 计算词的交集和并集
  const intersection = new Set([...querySet].filter(x => recordSet.has(x)));
  const union = new Set([...querySet, ...recordSet]);
  
  // Jaccard 相似度
  let similarity = intersection.size / union.size;
  
  // 如果应用名不同，相似度乘以0.3（即使动词相同也不算重复）
  if (!appMatch) {
    similarity *= 0.3;
  }
  
  return similarity;
}

// TF-IDF 相关函数
function preprocessText(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 0);
}

function computeTermFrequency(words: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  if (words.length === 0) return tf;
  
  for (const word of words) {
    tf.set(word, (tf.get(word) || 0) + 1);
  }
  const totalWords = words.length;
  for (const [word, count] of tf.entries()) {
    tf.set(word, count / totalWords);
  }
  return tf;
}

function computeIDF(documents: string[][]): Map<string, number> {
  const idf = new Map<string, number>();
  const docCount = documents.length;
  if (docCount === 0) return idf;
  
  const wordDocCount = new Map<string, number>();
  for (const doc of documents) {
    const uniqueWords = new Set(doc);
    for (const word of uniqueWords) {
      wordDocCount.set(word, (wordDocCount.get(word) || 0) + 1);
    }
  }

  for (const [word, count] of wordDocCount.entries()) {
    idf.set(word, Math.log(docCount / count));
  }
  return idf;
}

function computeTFIDF(tf: Map<string, number>, idf: Map<string, number>): Map<string, number> {
  const tfidf = new Map<string, number>();
  for (const [word, tfValue] of tf.entries()) {
    const idfValue = idf.get(word) || 0;
    tfidf.set(word, tfValue * idfValue);
  }
  return tfidf;
}

function cosineSimilarity(vec1: Map<string, number>, vec2: Map<string, number>): number {
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  const allWords = new Set([...vec1.keys(), ...vec2.keys()]);
  for (const word of allWords) {
    const v1 = vec1.get(word) || 0;
    const v2 = vec2.get(word) || 0;
    dotProduct += v1 * v2;
    norm1 += v1 * v1;
    norm2 += v2 * v2;
  }

  if (norm1 === 0 || norm2 === 0) return 0;
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { query } = await req.json();

    if (!query || typeof query !== 'string') {
      throw new Error('Query is required');
    }

    console.log(`Searching for: ${query}`);

    const { data: records, error } = await supabase
      .from('function_records')
      .select('*')
      .order('id');

    if (error) {
      throw new Error(`Failed to fetch records: ${error.message}`);
    }

    if (!records || records.length === 0) {
      return new Response(
        JSON.stringify({ results: [], message: '检索库为空，请先上传CSV文件' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${records.length} records in database`);

    // 归一化查询意图
    const queryIntent = normalizeIntent(query);
    console.log(`Query intent: "${query}" -> "${queryIntent}"`);

    // 准备文本相似度计算
    const queryWords = preprocessText(query);
    const allTextDocuments = records.map(r => preprocessText(r.search_text || ''));
    allTextDocuments.push(queryWords);

    const textIdf = computeIDF(allTextDocuments);
    const queryTextTF = computeTermFrequency(queryWords);
    const queryTextTFIDF = computeTFIDF(queryTextTF, textIdf);

    // 计算相似度
    const results: SearchResult[] = [];
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      
      // 为旧记录生成 intent_text
      const recordIntent = record.intent_text || normalizeIntent(record.search_text);
      
      // 意图相似度（考虑应用名）
      const intentSimilarity = computeIntentSimilarity(queryIntent, recordIntent);
      
      // 文本相似度（TF-IDF）
      const textWords = allTextDocuments[i];
      const textTF = computeTermFrequency(textWords);
      const textTFIDF = computeTFIDF(textTF, textIdf);
      const textSimilarity = cosineSimilarity(queryTextTFIDF, textTFIDF);
      
      // 综合判断：意图相似度 > 0.7 且文本相似度 > 0.3
      const isDuplicate = intentSimilarity >= 0.7 && textSimilarity >= 0.3;
      
      console.log(`Record ${record.id}: intent="${recordIntent}" (${intentSimilarity.toFixed(2)}) text(${textSimilarity.toFixed(2)}) duplicate=${isDuplicate}`);
      
      results.push({
        ...record,
        intent_text: recordIntent,
        intent_similarity: intentSimilarity,
        text_similarity: textSimilarity,
        is_duplicate: isDuplicate,
      });
    }

    // 排序
    results.sort((a, b) => {
      if (a.is_duplicate !== b.is_duplicate) {
        return a.is_duplicate ? -1 : 1;
      }
      if (Math.abs(a.intent_similarity - b.intent_similarity) > 0.01) {
        return b.intent_similarity - a.intent_similarity;
      }
      return b.text_similarity - a.text_similarity;
    });

    const top5 = results.slice(0, 5);

    console.log(`Returning ${top5.length} results, hasDuplicate=${top5.some(r => r.is_duplicate)}`);

    return new Response(
      JSON.stringify({
        results: top5,
        totalRecords: records.length,
        queryIntent: queryIntent,
        hasDuplicate: top5.some(r => r.is_duplicate),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Search error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
