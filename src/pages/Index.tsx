import { useState, useEffect, useCallback } from 'react';
import { Search, Upload, FileText, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface SearchResult {
  id: number;
  source_dir: string;
  source_file: string;
  row_number: number;
  level_1: string | null;
  function_point: string | null;
  sub_function: string | null;
  search_text: string;
  intent_text: string;
  intent_similarity: number;
  text_similarity: number;
  is_duplicate: boolean;
}

const Index = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [totalRecords, setTotalRecords] = useState(0);
  const [csvCount, setCsvCount] = useState(0);
  const [uploadMessage, setUploadMessage] = useState('');
  const [queryIntent, setQueryIntent] = useState('');
  const [hasDuplicate, setHasDuplicate] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      // 获取记录总数
      const { count: recordCount } = await supabase
        .from('function_records')
        .select('*', { count: 'exact', head: true });
      
      setTotalRecords(recordCount || 0);

      // 获取CSV文件数量
      const { count: fileCount } = await supabase
        .from('csv_files')
        .select('*', { count: 'exact', head: true });
      
      setCsvCount(fileCount || 0);
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  }, []);

  const checkAndUpdateIntentText = useCallback(async () => {
    try {
      // 检查是否有记录缺少 intent_text
      const { count } = await supabase
        .from('function_records')
        .select('*', { count: 'exact', head: true })
        .or('intent_text.is.null,intent_text.eq.');

      if (count && count > 0) {
        console.log(`Found ${count} records without intent_text, updating...`);
        // 调用更新函数
        const { data } = await supabase.functions.invoke('update-intent-text', {});
        if (data?.success) {
          console.log(data.message);
          await loadStats(); // 重新加载统计
        }
      }
    } catch (error) {
      console.error('Error updating intent text:', error);
    }
  }, [loadStats]);

  // 加载统计信息并检查是否需要更新意图文本
  useEffect(() => {
    loadStats();
    checkAndUpdateIntentText();
  }, [loadStats, checkAndUpdateIntentText]);

  const handleSearch = async () => {
    if (!query.trim()) {
      toast.error('请输入查询内容');
      return;
    }

    setIsSearching(true);
    setResults([]);

    try {
      const { data, error } = await supabase.functions.invoke('search-similar', {
        body: { query },
      });

      if (error) throw error;

      if (data.results && data.results.length > 0) {
        setResults(data.results);
        setTotalRecords(data.totalRecords);
        setQueryIntent(data.queryIntent || '');
        setHasDuplicate(data.hasDuplicate || false);
        
        if (data.hasDuplicate) {
          toast.error('⚠️ 功能已定义过！发现重复功能骨架');
        } else {
          const hasHighSimilarity = data.results.some((r: SearchResult) => r.intent_similarity > 0.5);
          if (hasHighSimilarity) {
            toast.warning('发现相似功能，建议检查');
          } else {
            toast.success(`找到 ${data.results.length} 条相关记录`);
          }
        }
      } else {
        toast.info(data.message || '未找到相似记录');
      }
    } catch (error) {
      console.error('Search error:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      toast.error(`搜索失败: ${errorMessage}`);
    } finally {
      setIsSearching(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.csv')) {
      toast.error('请上传 CSV 文件');
      return;
    }

    setIsUploading(true);
    setUploadMessage('');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const { data, error } = await supabase.functions.invoke('process-csv', {
        body: formData,
      });

      if (error) throw error;

      setUploadMessage(`上传成功！文件 "${data.filename}" 已处理，新增 ${data.recordCount} 条记录`);
      toast.success('CSV 上传成功，检索库已更新！');
      
      // 刷新统计信息
      await loadStats();
    } catch (error) {
      console.error('Upload error:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      toast.error(`上传失败: ${errorMessage}`);
    } finally {
      setIsUploading(false);
      // 重置文件选择
      event.target.value = '';
    }
  };

  const getIntentSimilarityColor = (similarity: number, isDuplicate: boolean) => {
    if (isDuplicate) return 'bg-red-500';
    if (similarity > 0.5) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getIntentSimilarityLabel = (similarity: number, isDuplicate: boolean) => {
    if (isDuplicate) return '功能已定义';
    if (similarity > 0.5) return '相似功能';
    return '不同功能';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* 标题区域 */}
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-slate-800 mb-2">功能查重系统</h1>
          <p className="text-slate-600">检查新功能是否已在历史CSV中被定义过</p>
        </div>

        {/* 统计信息卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">已加载CSV文件</p>
                  <p className="text-3xl font-bold text-slate-800">{csvCount}</p>
                </div>
                <FileText className="h-12 w-12 text-blue-500" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">功能记录总数</p>
                  <p className="text-3xl font-bold text-slate-800">{totalRecords}</p>
                </div>
                <FileText className="h-12 w-12 text-green-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 上传区域 */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              上传CSV文件
            </CardTitle>
            <CardDescription>
              上传CSV文件以补充检索库（文件将被持久化存储）
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                disabled={isUploading}
                className="flex-1"
              />
              {isUploading && (
                <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
              )}
            </div>
            {uploadMessage && (
              <Alert className="mt-4">
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>{uploadMessage}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* 搜索区域 */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              查询功能
            </CardTitle>
            <CardDescription>
              输入功能描述或查询文本，检查是否已存在相似功能
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                placeholder="例如：用户登录、订单管理、数据导出..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                className="flex-1"
              />
              <Button onClick={handleSearch} disabled={isSearching || !query.trim()}>
                {isSearching ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    搜索中
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    查询
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 结果展示区域 */}
        {results.length > 0 && (
          <div>
            <div className="mb-4">
              <h2 className="text-2xl font-bold text-slate-800 mb-2">
                搜索结果 (Top {results.length})
              </h2>
              {queryIntent && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-sm text-blue-700">
                    <span className="font-semibold">归一化意图：</span>{queryIntent}
                  </p>
                </div>
              )}
              {hasDuplicate && (
                <Alert className="mt-3 bg-red-50 border-red-200">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <AlertDescription className="text-red-700">
                    <strong>⚠️ 检测到重复功能！</strong>该功能骨架已在历史记录中存在，虽然具体参数可能不同，但核心操作相同。
                  </AlertDescription>
                </Alert>
              )}
            </div>
            <div className="space-y-4">
              {results.map((result, index) => (
                <Card key={result.id} className={`hover:shadow-lg transition-shadow ${result.is_duplicate ? 'border-2 border-red-300' : ''}`}>
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-3">
                          <Badge variant="outline" className="font-mono">
                            #{index + 1}
                          </Badge>
                          <Badge className={getIntentSimilarityColor(result.intent_similarity, result.is_duplicate)}>
                            {getIntentSimilarityLabel(result.intent_similarity, result.is_duplicate)}
                          </Badge>
                          <span className="text-sm font-bold text-slate-700">
                            意图: {(result.intent_similarity * 100).toFixed(1)}%
                          </span>
                          <span className="text-sm text-slate-600">
                            文本: {(result.text_similarity * 100).toFixed(1)}%
                          </span>
                        </div>
                        
                        {/* 功能意图展示 */}
                        {result.intent_text && (
                          <div className="mb-3 bg-amber-50 border border-amber-200 rounded p-2">
                            <p className="text-xs text-amber-700 font-semibold mb-1">功能意图（归一化后）：</p>
                            <p className="text-sm text-amber-900">{result.intent_text}</p>
                            {result.is_duplicate && (
                              <p className="text-xs text-red-600 mt-1">
                                💡 虽然搜索内容不同，但该功能骨架已存在
                              </p>
                            )}
                          </div>
                        )}
                        
                        {/* 功能路径 */}
                        <div className="mb-3">
                          <p className="text-sm text-slate-500 mb-1">功能路径：</p>
                          <div className="flex items-center gap-2 text-sm text-slate-700">
                            {result.level_1 && <span className="font-medium">{result.level_1}</span>}
                            {result.function_point && (
                              <>
                                <span className="text-slate-400">›</span>
                                <span className="font-medium">{result.function_point}</span>
                              </>
                            )}
                            {result.sub_function && (
                              <>
                                <span className="text-slate-400">›</span>
                                <span className="font-medium">{result.sub_function}</span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* 搜索文本预览 */}
                        <div className="mb-3">
                          <p className="text-sm text-slate-500 mb-1">匹配内容：</p>
                          <p className="text-sm text-slate-700 bg-slate-50 p-2 rounded">
                            {result.search_text.slice(0, 200)}
                            {result.search_text.length > 200 && '...'}
                          </p>
                        </div>

                        {/* 来源信息 */}
                        <div className="flex items-center gap-4 text-xs text-slate-500">
                          <span>📁 {result.source_file}</span>
                          <span>📍 第 {result.row_number} 行</span>
                          <span>📂 {result.source_dir}</span>
                        </div>
                      </div>

                      {result.is_duplicate && (
                        <AlertCircle className="h-6 w-6 text-red-500 flex-shrink-0 ml-4" />
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* 空状态提示 */}
        {results.length === 0 && query && !isSearching && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              未找到相似记录。{totalRecords === 0 ? '检索库为空，请先上传CSV文件。' : ''}
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
};

export default Index;
