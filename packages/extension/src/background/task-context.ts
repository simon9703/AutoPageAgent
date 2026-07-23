export function taskNeedsPerformance(task: string): boolean {
  return /(?:performance|network|request|api|ttfb|load time|waterfall|性能|网络|请求|接口|加载耗时)/iu.test(task);
}
