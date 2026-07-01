/**
 * 无闪屏主题脚本。被 BaseHead 以 <script src> 同步引入（render-blocking，
 * 先于 body 绘制执行），因此不需要内联脚本——满足 CSP `script-src 'self'`。
 *
 * 主题信号：<html class="dark"> 表示暗色（dark-first）。
 * 偏好来源：localStorage 'theme' ∈ {dark,light}；缺省时跟随系统，且默认偏暗。
 */
(function () {
  function apply() {
    try {
      var stored = localStorage.getItem('theme');
      var systemLight = window.matchMedia('(prefers-color-scheme: light)').matches;
      var dark = stored ? stored === 'dark' : !systemLight; // 无偏好默认暗
      document.documentElement.classList.toggle('dark', dark);
    } catch (e) {
      document.documentElement.classList.add('dark');
    }
  }
  apply();
  // View Transitions 切页后重新应用，避免主题闪回
  document.addEventListener('astro:after-swap', apply);
})();
