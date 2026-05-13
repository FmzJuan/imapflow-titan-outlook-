// limparMeta.js
const fs = require('fs');
const path = require('path');

function executarLimpezaMeta(data, userId) {
    const LIMITE_DIAS_HISTORICO = 30; // Mantém por 30 dias após a exclusão
    const dataCorte = new Date();
    dataCorte.setDate(dataCorte.getDate() - LIMITE_DIAS_HISTORICO);

    let entradasRemovidas = 0;
    const ids = Object.keys(data);

    for (const msgId of ids) {
        const info = data[msgId];
        
        // Só removemos se o e-mail já foi excluído do servidor de origem
        if (info.excluidoDoTitan && info.dataExclusao) {
            const dataExclusao = new Date(info.dataExclusao);
            if (dataExclusao < dataCorte) {
                delete data[msgId];
                entradasRemovidas++;
            }
        }
    }

    if (entradasRemovidas > 0) {
        console.log(`   [MANUTENÇÃO META] ${userId}: ${entradasRemovidas} registros antigos limpos.`);
    }

    return data;
}

module.exports = { executarLimpezaMeta };