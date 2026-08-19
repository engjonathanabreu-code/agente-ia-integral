/*
============================================
HORÁRIO COMERCIAL
============================================

Define o horário comercial usado pela regra
de "cutucada" por inatividade (30 minutos
sem resposta de um atendente humano).

Horário: Segunda a Sexta, 08h às 18h,
fuso horário de São Paulo (America/Sao_Paulo).
Sem exclusão de horário de almoço.
*/

const TIMEZONE = "America/Sao_Paulo";

const BUSINESS_WEEKDAYS = new Set([1, 2, 3, 4, 5]); // Seg a Sex

const START_MINUTES = 8 * 60; // 08:00
const END_MINUTES = 18 * 60; // 18:00

const WEEKDAY_MAP = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};


/*
Extrai dia da semana, hora, minuto e a
data (YYYY-MM-DD) no fuso de São Paulo,
independente do fuso do servidor.
*/

function saoPauloParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;

  const weekday = WEEKDAY_MAP[get("weekday")];
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const dateKey = `${get("year")}-${get("month")}-${get("day")}`;

  return { weekday, hour, minute, dateKey };
}


/*
Retorna o estado da agenda no momento informado:

- open: true se estamos dentro do horário comercial
- justClosed: true se é um dia útil, mas já passou
  das 18h (mesmo dia, ainda não virou a madrugada)
- dateKey: data (fuso SP) usada para deduplicar o
  aviso de "fim de expediente" e evitar reenvios
  depois da meia-noite
*/

function getScheduleState(date = new Date()) {
  const { weekday, hour, minute, dateKey } = saoPauloParts(date);
  const totalMinutes = hour * 60 + minute;
  const isBusinessDay = BUSINESS_WEEKDAYS.has(weekday);

  return {
    dateKey,
    open:
      isBusinessDay &&
      totalMinutes >= START_MINUTES &&
      totalMinutes < END_MINUTES,
    justClosed: isBusinessDay && totalMinutes >= END_MINUTES,
  };
}


export { getScheduleState, saoPauloParts };
