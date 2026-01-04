import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// 动词归一化映射表
const ACTION_NORMALIZATION: { [key: string]: string } = {
  '打开': '打开', '进入': '打开', '启动': '打开', '开启': '打开', '访问': '打开',
  '搜索': '搜索', '查找': '搜索', '搜一下': '搜索', '找': '搜索', '检索': '搜索',
  '播放': '播放', '听': '播放', '听一下': '播放', '放': '播放', '观看': '播放', '看': '播放',
  '点赞': '点赞', '赞': '点赞', '喜欢': '点赞',
  '评论': '评论', '留言': '评论', '发表评论': '评论',
  '关注': '关注', '订阅': '关注', '加关注': '关注',
  '分享': '分享', '转发': '分享',
  '收藏': '收藏', '保存': '收藏',
  '删除': '删除', '移除': '删除',
  '添加': '添加', '新增': '添加', '创建': '添加',
  '编辑': '编辑', '修改': '编辑', '更改': '编辑',
  '查看': '查看', '浏览': '查看', '查询': '查看',
  '下载': '下载', '保存到本地': '下载',
  '上传': '上传', '发布': '上传',
  '登录': '登录', '登陆': '登录', '登入': '登录',
  '退出': '退出', '登出': '退出', '退出登录': '退出',
  '取消': '取消', '撤销': '取消',
};

const SLOT_PATTERNS = [
  /[《「『"'](.*?)[》」』"']/g,
  /(?<!打开|搜索|播放|查看)([a-zA-Z0-9]{2,}|[\u4e00-\u9fa5]{3,10})(?!的|了|是|在|有)/g,
];

function normalizeIntent(text: string): string {
  if (!text) return '';
  
  let normalized = text;
  
  for (const pattern of SLOT_PATTERNS) {
    normalized = normalized.replace(pattern, '<QUERY>');
  }
  
  const words = normalized.split(/\s+/);
  const normalizedWords: string[] = [];
  
  for (const word of words) {
    if (word === '<QUERY>') continue;
    
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
    
    if (!found && word.length >= 2 && !word.match(/^[的了是在有个这那]/)) {
      normalizedWords.push(word);
    }
  }
  
  return [...new Set(normalizedWords)].join(' ').trim();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 获取所有 intent_text 为空的记录
    const { data: records, error: fetchError } = await supabase
      .from('function_records')
      .select('id, search_text, intent_text')
      .or('intent_text.is.null,intent_text.eq.');

    if (fetchError) {
      throw new Error(`Failed to fetch records: ${fetchError.message}`);
    }

    if (!records || records.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: '所有记录都已有 intent_text',
          updated: 0 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${records.length} records without intent_text`);

    // 批量更新
    let updated = 0;
    for (const record of records) {
      const intentText = normalizeIntent(record.search_text);
      
      const { error: updateError } = await supabase
        .from('function_records')
        .update({ intent_text: intentText })
        .eq('id', record.id);

      if (updateError) {
        console.error(`Failed to update record ${record.id}:`, updateError);
      } else {
        updated++;
      }
    }

    console.log(`Successfully updated ${updated} records`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `成功为 ${updated} 条记录生成 intent_text`,
        updated,
        total: records.length,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
