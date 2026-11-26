// Mostra uma faixa no topo quando o sistema está rodando no ambiente de teste.
// Em produção (/api/env devolve "production") não aparece nada.
(function () {
  fetch('/api/env')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (info) {
      if (!info || info.env !== 'staging') return;
      var bar = document.createElement('div');
      bar.textContent = 'AMBIENTE DE TESTE · os dados aqui não são reais';
      bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#f59e0b;color:#1f2937;' +
        'text-align:center;font:600 13px/1.2 system-ui,sans-serif;padding:6px 8px;letter-spacing:.03em';
      document.body.insertBefore(bar, document.body.firstChild);
      document.body.style.paddingTop = '30px';
      document.title = '[TESTE] ' + document.title;
    })
    .catch(function () {});
})();
