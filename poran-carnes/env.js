// Configuração de ambiente (produção x teste).
//
// APP_ENV=staging  -> ambiente de teste: mostra a faixa "AMBIENTE DE TESTE"
//                     e libera o script de dados de exemplo (seed-staging.js).
// APP_ENV ausente  -> tratado como produção (comportamento de sempre).
//
// Trava de segurança: se APP_ENV=staging e PROD_DATABASE_HOST estiver definido,
// o sistema se recusa a subir quando o DATABASE_URL aponta para esse host.
// Assim o ambiente de teste nunca roda (nem a limpeza do database.js) no banco real.

const APP_ENV = (process.env.APP_ENV || 'production').toLowerCase();
const isStaging = APP_ENV === 'staging';

function dbHost(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch (e) { return ''; }
}

function assertSafeDatabase() {
  if (!isStaging) return;
  const prodHost = (process.env.PROD_DATABASE_HOST || '').trim().toLowerCase();
  const host = dbHost(process.env.DATABASE_URL || '');
  if (prodHost && host && host === prodHost) {
    console.error('ERRO: APP_ENV=staging mas DATABASE_URL aponta para o banco de PRODUÇÃO (' + host + '). Abortando.');
    process.exit(1);
  }
  console.log('Ambiente de TESTE (staging). Banco: ' + (host || 'local'));
}

module.exports = { APP_ENV, isStaging, assertSafeDatabase };
