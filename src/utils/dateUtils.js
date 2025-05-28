/**
 * Utilidades para manejo de fechas en la zona horaria de Perú
 */

const PERU_TZ = 'America/Lima';

/**
 * Obtiene la fecha y hora actual en Perú
 * @returns {Date} Fecha actual en la zona horaria de Perú
 */
function getCurrentPeruDate() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: PERU_TZ }));
}

/**
 * Formatea una fecha para mostrarla en formato peruano
 * @param {Date} date - Fecha a formatear
 * @returns {string} Fecha formateada en formato peruano
 */
function formatPeruDate(date) {
    return new Intl.DateTimeFormat('es-PE', { 
        timeZone: PERU_TZ,
        dateStyle: 'full',
        timeStyle: 'long'
    }).format(date);
}

/**
 * Obtiene el inicio del día en Perú para una fecha dada
 * @param {Date} date - Fecha de referencia (opcional, por defecto usa la fecha actual)
 * @returns {Date} Fecha al inicio del día (00:00:00) en la zona horaria de Perú
 */
function getPeruStartOfDay(date = getCurrentPeruDate()) {
    const peruDate = new Date(date.toLocaleString('en-US', { timeZone: PERU_TZ }));
    peruDate.setHours(0, 0, 0, 0);
    return peruDate;
}

/**
 * Obtiene el fin del día en Perú para una fecha dada
 * @param {Date} date - Fecha de referencia (opcional, por defecto usa la fecha actual)
 * @returns {Date} Fecha al final del día (23:59:59.999) en la zona horaria de Perú
 */
function getPeruEndOfDay(date = getCurrentPeruDate()) {
    const peruDate = new Date(date.toLocaleString('en-US', { timeZone: PERU_TZ }));
    peruDate.setHours(23, 59, 59, 999);
    return peruDate;
}

module.exports = {
    getCurrentPeruDate,
    formatPeruDate,
    getPeruStartOfDay,
    getPeruEndOfDay,
    PERU_TZ
}; 