import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FunctionRecord {
  source_dir: string;
  source_file: string;
  row_number: number;
  level_1: string | null;
  function_point: string | null;
  sub_function: string | null;
  search_text: string;
  intent_text: string;
}

// 动词归一化映射表
const ACTION_NORMALIZATION: { [key: string]: string } = {
  // 打开类
  '打开': '打开',
  '进入': '打开',
  '启动': '打开',
  '开启': '打开',
  '访问': '打开',
  
  // 搜索类
  '搜索': '搜索',
  '查找': '搜索',
  '搜一下': '搜索',
  '找': '搜索',
  '检索': '搜索',
  
  // 播放类
  '播放': '播放',
  '听': '播放',
  '听一下': '播放',
  '放': '播放',
  '观看': '播放',
  '看': '播放',
  
  // 点赞类
  '点赞': '点赞',
  '赞': '点赞',
  '喜欢': '点赞',
  
  // 评论类
  '评论': '评论',
  '留言': '评论',
  '发表评论': '评论',
  
  // 关注类
  '关注': '关注',
  '订阅': '关注',
  '加关注': '关注',
  
  // 分享类
  '分享': '分享',
  '转发': '分享',
  
  // 收藏类
  '收藏': '收藏',
  '保存': '收藏',
  
  // 删除类
  '删除': '删除',
  '移除': '删除',
  
  // 添加类
  '添加': '添加',
  '新增': '添加',
  '创建': '添加',
  
  // 编辑类
  '编辑': '编辑',
  '修改': '编辑',
  '更改': '编辑',
  
  // 查看类
  '查看': '查看',
  '浏览': '查看',
  '查询': '查看',
  
  // 下载类
  '下载': '下载',
  '保存到本地': '下载',
  
  // 上传类
  '上传': '上传',
  '发布': '上传',
  
  // 登录类
  '登录': '登录',
  '登陆': '登录',
  '登入': '登录',
  
  // 退出类
  '退出': '退出',
  '登出': '退出',
  '退出登录': '退出',
  
  // 取消类
  '取消': '取消',
  '撤销': '取消',
};

// 参数识别模式（这些通常是变量内容）
const SLOT_PATTERNS = [
  // 歌曲名、歌手名等（包含引号、书名号的内容）
  /[《「『"'](.*?)[》」』"']/g,
  // 人名、专有名词（3-10个字的连续中文，但排除常见动词）
  /(?<!打开|搜索|播放|查看)([a-zA-Z0-9]{2,}|[\u4e00-\u9fa5]{3,10})(?!的|了|是|在|有)/g,
];

// 归一化文本：提取核心动作骨架
function normalizeIntent(text: string): string {
  let normalized = text;
  
  // 1. 参数剥离：将明显的参数替换为 <QUERY>
  for (const pattern of SLOT_PATTERNS) {
    normalized = normalized.replace(pattern, '<QUERY>');
  }
  
  // 2. 动词归一化
  const words = normalized.split(/\s+/);
  const normalizedWords: string[] = [];
  
  for (const word of words) {
    // 跳过 <QUERY> 占位符
    if (word === '<QUERY>') {
      continue;
    }
    
    // 查找是否有归一化映射
    let found = false;
    for (const [key, value] of Object.entries(ACTION_NORMALIZATION)) {
      if (word.includes(key)) {
        if (!normalizedWords.includes(value)) {
          normalizedWords.push(value);
        }
        found = true;
        break;
      }
    }
    
    // 如果不是动词，但是重要的名词（如应用名、功能模块），保留
    if (!found && word.length >= 2 && !word.match(/^[的了是在有个这那]/)) {
      normalizedWords.push(word);
    }
  }
  
  // 3. 去重并返回
  return [...new Set(normalizedWords)].join(' ').trim();
}

// 高级意图提取：结合结构化字段
function extractIntent(
  level1: string | null,
  functionPoint: string | null,
  subFunction: string | null,
  queries: string[]
): string {
  const parts: string[] = [];
  
  // 优先使用结构化字段
  if (level1) parts.push(level1);
  if (functionPoint) parts.push(functionPoint);
  if (subFunction) parts.push(subFunction);
  
  // 再处理 query
  for (const query of queries) {
    const normalized = normalizeIntent(query);
    if (normalized) {
      parts.push(normalized);
    }
  }
  
  // 合并并归一化整体
  const combined = parts.join(' ');
  return normalizeIntent(combined);
}

// 解析CSV文本
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      if (currentCell || currentRow.length > 0) {
        currentRow.push(currentCell.trim());
        rows.push(currentRow);
        currentRow = [];
        currentCell = '';
      }
    } else {
      currentCell += char;
    }
  }

  if (currentCell || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    rows.push(currentRow);
  }

  return rows;
}

// 处理CSV并提取功能记录
function processCSVData(csvData: string[][], filename: string): FunctionRecord[] {
  if (csvData.length === 0) return [];

  const headers = csvData[0].map(h => h.trim());
  const records: FunctionRecord[] = [];

  // 找到关键列的索引
  const level1Index = headers.findIndex(h => h.includes('一级界面'));
  const functionPointIndex = headers.findIndex(h => h.includes('具体功能点'));
  const subFunctionIndex = headers.findIndex(h => h.includes('细分功能点'));
  
  // 找到所有query相关列
  const queryIndices: number[] = [];
  headers.forEach((h, i) => {
    if (h.includes('query') || h.includes('Query')) {
      queryIndices.push(i);
    }
  });

  // Forward fill变量
  let lastLevel1 = '';
  let lastFunctionPoint = '';
  let lastSubFunction = '';

  // 从第二行开始处理（跳过标题行）
  for (let i = 1; i < csvData.length; i++) {
    const row = csvData[i];
    
    // Forward fill逻辑
    const level1 = row[level1Index]?.trim() || lastLevel1;
    const functionPoint = row[functionPointIndex]?.trim() || lastFunctionPoint;
    const subFunction = row[subFunctionIndex]?.trim() || lastSubFunction;

    if (level1) lastLevel1 = level1;
    if (functionPoint) lastFunctionPoint = functionPoint;
    if (subFunction) lastSubFunction = subFunction;

    // 收集所有query值
    const queries: string[] = [];
    for (const idx of queryIndices) {
      const val = row[idx]?.trim();
      if (val && !val.startsWith('Unnamed')) {
        queries.push(val);
      }
    }

    // 如果没有任何有效数据，跳过
    if (!level1 && !functionPoint && !subFunction && queries.length === 0) {
      continue;
    }

    // 构建search_text（原始完整文本）
    const searchParts: string[] = [];
    if (level1) searchParts.push(level1);
    if (functionPoint) searchParts.push(functionPoint);
    if (subFunction) searchParts.push(subFunction);
    searchParts.push(...queries);
    const searchText = searchParts.join(' ');

    // 构建intent_text（归一化后的功能意图）
    const intentText = extractIntent(level1, functionPoint, subFunction, queries);

    if (searchText.trim()) {
      records.push({
        source_dir: 'uploads',
        source_file: filename,
        row_number: i + 1,
        level_1: level1 || null,
        function_point: functionPoint || null,
        sub_function: subFunction || null,
        search_text: searchText,
        intent_text: intentText || searchText, // 如果归一化失败，回退到原文
      });
    }
  }

  return records;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const formData = await req.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      throw new Error('No file uploaded');
    }

    const filename = file.name;
    const fileContent = await file.text();

    console.log(`Processing CSV file: ${filename}`);

    // 解析CSV
    const csvData = parseCSV(fileContent);
    console.log(`Parsed ${csvData.length} rows`);

    // 处理CSV数据
    const records = processCSVData(csvData, filename);
    console.log(`Extracted ${records.length} function records`);

    // 删除该文件的旧记录（如果存在）
    const { error: deleteError } = await supabase
      .from('function_records')
      .delete()
      .eq('source_file', filename);

    if (deleteError) {
      console.error('Error deleting old records:', deleteError);
    }

    // 批量插入新记录
    if (records.length > 0) {
      const { error: insertError } = await supabase
        .from('function_records')
        .insert(records);

      if (insertError) {
        throw new Error(`Failed to insert records: ${insertError.message}`);
      }
    }

    // 上传文件到Storage
    const filePath = `uploads/${Date.now()}_${filename}`;
    const { error: uploadError } = await supabase.storage
      .from('csv-files')
      .upload(filePath, file, { upsert: true });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
    }

    // 更新或插入CSV文件元数据
    const { error: upsertError } = await supabase
      .from('csv_files')
      .upsert({
        filename,
        file_path: filePath,
        record_count: records.length,
        uploaded_at: new Date().toISOString(),
      }, {
        onConflict: 'filename'
      });

    if (upsertError) {
      console.error('Error updating csv_files:', upsertError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        filename,
        recordCount: records.length,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error processing CSV:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
