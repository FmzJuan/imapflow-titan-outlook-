// limparLog.js
const fs = require('fs');
const path = require('path');

async function executarLimpezaLog(caminhoLog) {
    if (!fs.existsSync(caminhoLog)) return;

    const LIMITE_DIAS_LOG = 15;
    const hoje = new Date();
    const dataCorte = new Date();
    dataCorte.setDate(hoje.getDate() - LIMITE_DIAS_LOG);

    try {
        const conteudo = fs.readFileSync(caminhoLog, 'utf8');
        const linhas = conteudo.split('\n');
        
        const linhasFiltradas = linhas.filter(linha => {
            // Tenta extrair a data [DD/MM/AAAA, HH:MM:SS]
            const match = linha.match(/\[(\d{2})\/(\d{2})\/(\d{4})/);
            if (match) {
                const dia = parseInt(match[1]);
                const mes = parseInt(match[2]) - 1;
                const ano = parseInt(match[3]);
                const dataLinha = new Date(ano, mes, dia);
                
                return dataLinha >= dataCorte;
            }
            // Se a linha não tem data (ex: linha em branco), mantemos para não quebrar o log
            return true;
        });

        if (linhas.length !== linhasFiltradas.length) {
            fs.writeFileSync(caminhoLog, linhasFiltradas.join('\n'));
            console.log(`   [MANUTENÇÃO LOG] Arquivo de log reduzido para os últimos ${LIMITE_DIAS_LOG} dias.`);
        }
    } catch (err) {
        console.error("[ERRO LIMPEZA LOG]:", err.message);
    }
}

module.exports = { executarLimpezaLog };