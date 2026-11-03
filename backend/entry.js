(() => {
  const status = document.getElementById('status');
  if (location.protocol === 'file:') {
    status.textContent = '打开方式不正确。请点击页面顶部“打开本机任务台”，或运行“开始验证.cmd”。';
    document.querySelectorAll('button, input, select, textarea').forEach(element => { element.disabled = true; });
    return;
  }
  const timer = setTimeout(() => { status.textContent = '页面初始化超时，请刷新页面，或重新运行“开始验证.cmd”。'; }, 12000);
  import('./dashboard.mjs').then(() => clearTimeout(timer)).catch(() => {
    clearTimeout(timer);
    status.textContent = '页面脚本加载失败，请刷新页面，或重新运行“开始验证.cmd”。';
  });
})();
