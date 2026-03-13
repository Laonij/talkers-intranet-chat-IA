const CALENDAR_EVENT_TYPE_DEFINITIONS = [
  {
    key: "meeting",
    name: "Reuniao",
    description: "Alinhamentos internos, checkpoints e reunioes de rotina.",
    color: "#2563eb",
    icon: "calendar",
  },
  {
    key: "training",
    name: "Treinamento",
    description: "Capacitacoes, onboardings e sessoes de desenvolvimento interno.",
    color: "#7c3aed",
    icon: "graduation",
  },
  {
    key: "class",
    name: "Aula interna",
    description: "Aulas-modelo, observacoes e encontros pedagogicos.",
    color: "#059669",
    icon: "book-open",
  },
  {
    key: "follow_up",
    name: "Follow-up",
    description: "Compromissos comerciais, pos-venda e retornos combinados.",
    color: "#ea580c",
    icon: "target",
  },
  {
    key: "event",
    name: "Evento interno",
    description: "Comunicados, acoes especiais e eventos da escola.",
    color: "#db2777",
    icon: "sparkles",
  },
];

const CALENDAR_MEETING_MODES = [
  { key: "online", label: "Online" },
  { key: "presencial", label: "Presencial" },
  { key: "hibrida", label: "Hibrida" },
];

function normalizeCalendarText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sanitizeMeetingMode(value = "") {
  const normalized = normalizeCalendarText(value);
  if (normalized === "online") return "online";
  if (normalized === "presencial") return "presencial";
  if (normalized === "hibrida" || normalized === "hibrido" || normalized === "hybrid") return "hibrida";
  return "online";
}

function buildCalendarEventTypeSeedRows() {
  return CALENDAR_EVENT_TYPE_DEFINITIONS.map((item, index) => ({
    key: item.key,
    name: item.name,
    description: item.description,
    color: item.color,
    icon: item.icon,
    isActive: true,
    sortOrder: (index + 1) * 10,
  }));
}

module.exports = {
  CALENDAR_EVENT_TYPE_DEFINITIONS,
  CALENDAR_MEETING_MODES,
  buildCalendarEventTypeSeedRows,
  normalizeCalendarText,
  sanitizeMeetingMode,
};
