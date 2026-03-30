"use strict";

const {
  migrate,
  all,
  get,
  run,
  logEvent,
  DB_CLIENT,
} = require("../db");

const RELATION_TYPES = ["mae", "pai", "responsavel", "madrasta", "padrasto"];
const PAYMENT_METHODS = ["pix", "boleto", "cartao"];
const ATTENDANCE_STATUSES = ["presente", "presente", "presente", "presente", "atraso", "falta", "falta_justificada", "reposicao"];
const GUARDIAN_FIRST_NAMES_A = [
  "Mariana", "Patricia", "Carla", "Fernanda", "Juliana", "Renata", "Ana Paula", "Vanessa", "Luciana", "Camila",
];
const GUARDIAN_FIRST_NAMES_B = [
  "Ricardo", "Carlos", "Eduardo", "Paulo", "Roberto", "Marcelo", "Andre", "Fabio", "Rodrigo", "Marcos",
];

function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function escapeDigits(value = "") {
  return String(value || "").replace(/\D+/g, "");
}

function deterministicDigits(seed, length) {
  let value = Math.abs(Number(seed || 1)) + 17;
  let out = "";
  while (out.length < length) {
    value = (value * 1664525 + 1013904223) % 4294967296;
    out += String(value);
  }
  return out.slice(0, length);
}

function formatCpf(seed) {
  const digits = deterministicDigits(seed, 11);
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
}

function formatPhone(seed) {
  const area = String((Number(seed || 0) % 67) + 11).padStart(2, "0");
  const digits = deterministicDigits(seed * 7 + 19, 8);
  return `(${area}) 9${digits.slice(0, 4)}-${digits.slice(4, 8)}`;
}

function formatEmail(name = "", studentId = 0, suffix = "family.local") {
  const base = normalizeText(name)
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 36);
  return `${base || `responsavel.${studentId}`}.${studentId}@${suffix}`;
}

function formatDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function addDays(dateKey, amount) {
  const date = new Date(`${String(dateKey)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(amount || 0));
  return formatDateKey(date);
}

function addMonths(dateKey, amount) {
  const date = new Date(`${String(dateKey)}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + Number(amount || 0));
  return formatDateKey(date);
}

function pick(array, seed) {
  if (!Array.isArray(array) || !array.length) return "";
  return array[Math.abs(Number(seed || 0)) % array.length];
}

function buildGuardianBaseName(studentName = "", studentId = 0, variant = 0) {
  const parts = String(studentName || "").trim().split(/\s+/).filter(Boolean);
  const suffix = parts.slice(-2).join(" ") || parts.slice(-1).join(" ") || "Silva";
  const firstName = variant === 0
    ? pick(GUARDIAN_FIRST_NAMES_A, studentId)
    : pick(GUARDIAN_FIRST_NAMES_B, studentId + 11);
  return `${firstName} ${suffix}`.trim();
}

async function ensureStudentProfileSeed(actorUserId = null) {
  const students = await all(
    `SELECT id, full_name, preferred_name, cpf, rg, email, phone, whatsapp, emergency_contact_name, emergency_contact_phone
       FROM students
      ORDER BY id ASC`
  );

  let updatedStudents = 0;
  let timelineInserted = 0;

  for (const student of students) {
    const hasChanges = !String(student.cpf || "").trim()
      || !String(student.rg || "").trim()
      || !String(student.email || "").trim()
      || !String(student.phone || "").trim()
      || !String(student.whatsapp || "").trim()
      || !String(student.emergency_contact_name || "").trim()
      || !String(student.emergency_contact_phone || "").trim();

    if (!hasChanges) continue;

    const displayName = String(student.preferred_name || student.full_name || "").trim() || `Aluno ${student.id}`;
    await run(
      `UPDATE students
          SET cpf=COALESCE(NULLIF(cpf, ''), ?),
              rg=COALESCE(NULLIF(rg, ''), ?),
              email=COALESCE(NULLIF(email, ''), ?),
              phone=COALESCE(NULLIF(phone, ''), ?),
              whatsapp=COALESCE(NULLIF(whatsapp, ''), ?),
              emergency_contact_name=COALESCE(NULLIF(emergency_contact_name, ''), ?),
              emergency_contact_phone=COALESCE(NULLIF(emergency_contact_phone, ''), ?),
              notes=CASE WHEN coalesce(notes, '')='' THEN ? ELSE notes END,
              updated_at=datetime('now')
        WHERE id=?`,
      [
        formatCpf(student.id * 23 + 5),
        deterministicDigits(student.id * 29 + 9, 9),
        formatEmail(displayName, student.id, "students.local"),
        formatPhone(student.id * 5 + 1),
        formatPhone(student.id * 5 + 1),
        buildGuardianBaseName(student.full_name, student.id, 0),
        formatPhone(student.id * 11 + 5),
        "[DEMO] Dados cadastrais complementados para validacao operacional.",
        student.id,
      ]
    );
    updatedStudents += 1;

    const existingTimeline = await get(
      "SELECT id FROM student_timeline WHERE student_id=? AND event_type='student_profile_seeded' LIMIT 1",
      [student.id]
    );
    if (!existingTimeline?.id) {
      await run(
        `INSERT INTO student_timeline
           (student_id, event_type, title, description, actor_user_id, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          student.id,
          "student_profile_seeded",
          "Cadastro ficticio complementar gerado",
          "CPF, contatos e dados basicos foram preenchidos para validar a busca e a Ficha 360.",
          actorUserId,
          JSON.stringify({ source: "demo_seed" }),
        ]
      );
      timelineInserted += 1;
    }
  }

  return { studentsSeen: students.length, updatedStudents, timelineInserted };
}

async function ensureGuardianSeed(actorUserId = null) {
  const students = await all(
    `SELECT s.id, s.full_name, s.email, s.phone, s.whatsapp
       FROM students s
      WHERE NOT EXISTS (SELECT 1 FROM student_guardians sg WHERE sg.student_id=s.id)
      ORDER BY s.id ASC`
  );

  let guardiansInserted = 0;
  let timelineInserted = 0;
  for (const student of students) {
    const relationType = pick(RELATION_TYPES, student.id);
    const guardianName = buildGuardianBaseName(student.full_name, student.id, 0);
    const guardianCpf = formatCpf(student.id * 13 + 7);
    const guardianPhone = student.phone || student.whatsapp || formatPhone(student.id);
    const guardianEmail = formatEmail(guardianName, student.id);
    const created = await run(
      `INSERT INTO student_guardians
         (student_id, name, relation_type, cpf, phone, whatsapp, email, financial_responsible, pedagogical_responsible, receives_notifications, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        student.id,
        guardianName,
        relationType,
        guardianCpf,
        guardianPhone,
        guardianPhone,
        guardianEmail,
        1,
        1,
        1,
        "[DEMO] Responsavel ficticio gerado para validacao operacional.",
      ]
    );
    guardiansInserted += created?.lastID ? 1 : 0;

    if (student.id % 5 === 0) {
      const secondName = buildGuardianBaseName(student.full_name, student.id, 1);
      await run(
        `INSERT INTO student_guardians
           (student_id, name, relation_type, cpf, phone, whatsapp, email, financial_responsible, pedagogical_responsible, receives_notifications, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          student.id,
          secondName,
          relationType === "mae" ? "pai" : "responsavel",
          formatCpf(student.id * 19 + 3),
          formatPhone(student.id * 3 + 9),
          formatPhone(student.id * 3 + 9),
          formatEmail(secondName, student.id, "guardians.local"),
          0,
          0,
          1,
          "[DEMO] Responsavel secundario ficticio.",
        ]
      );
      guardiansInserted += 1;
    }

    const existingTimeline = await get(
      "SELECT id FROM student_timeline WHERE student_id=? AND event_type='guardian_profile_seeded' LIMIT 1",
      [student.id]
    );
    if (!existingTimeline?.id) {
      await run(
        `INSERT INTO student_timeline
           (student_id, event_type, title, description, actor_user_id, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          student.id,
          "guardian_profile_seeded",
          "Responsaveis de demonstracao criados",
          "Cadastro ficticio de responsavel criado para validacao da Ficha 360 e da busca de atendimento.",
          actorUserId,
          JSON.stringify({ source: "demo_seed" }),
        ]
      );
      timelineInserted += 1;
    }
  }

  return { studentsWithoutGuardians: students.length, guardiansInserted, timelineInserted };
}

function buildInstallmentPlan(contractId, installmentCount) {
  const count = Math.max(3, Number(installmentCount || 0) || (contractId % 3 === 0 ? 12 : 6));
  const monthlyAmount = 279 + ((contractId % 8) * 60);
  const firstDueDate = addDays(formatDateKey(new Date()), -45 + (contractId % 18));
  const items = [];
  for (let index = 0; index < count; index += 1) {
    const dueDate = addMonths(firstDueDate, index);
    let status = "pending";
    let paidAt = null;
    if (index === 0 || (index === 1 && contractId % 2 === 0)) {
      status = "paid";
      paidAt = `${addDays(dueDate, 2)}T10:00:00`;
    } else if (index === 1 && contractId % 4 === 0) {
      status = "overdue";
    } else if (index === 2 && contractId % 9 === 0) {
      status = "negotiated";
    } else if (dueDate < formatDateKey(new Date())) {
      status = contractId % 5 === 0 ? "overdue" : "pending";
    }
    items.push({
      installmentNumber: index + 1,
      dueDate,
      amount: monthlyAmount,
      status,
      paidAt,
      paymentMethod: status === "paid" ? pick(PAYMENT_METHODS, contractId + index) : null,
    });
  }
  return {
    installmentCount: count,
    monthlyAmount,
    totalAmount: count * monthlyAmount,
    firstDueDate,
    billingCycleDay: Number(String(firstDueDate).slice(-2)) || 10,
    items,
  };
}

async function ensureFinancialInstallmentSeed(actorUserId = null) {
  const contracts = await all(
    `SELECT fc.*, s.full_name AS student_name
       FROM financial_contracts fc
       JOIN students s ON s.id = fc.student_id
      ORDER BY fc.id ASC`
  );

  let contractsUpdated = 0;
  let installmentsInserted = 0;
  let timelineInserted = 0;

  for (const contract of contracts) {
    const guardians = await all(
      `SELECT id, name, cpf
         FROM student_guardians
        WHERE student_id=?
        ORDER BY financial_responsible DESC, pedagogical_responsible DESC, id ASC`,
      [contract.student_id]
    );
    const primaryGuardian = guardians[0] || null;
    const existingInstallments = await all(
      "SELECT id FROM financial_installments WHERE contract_id=? ORDER BY installment_number ASC",
      [contract.id]
    );
    const plan = buildInstallmentPlan(contract.id, contract.installments_count);

    await run(
      `UPDATE financial_contracts
          SET responsible_guardian_id=COALESCE(responsible_guardian_id, ?),
              contract_status=?,
              total_amount=COALESCE(total_amount, ?),
              installments_count=CASE WHEN coalesce(installments_count, 0) <= 0 THEN ? ELSE installments_count END,
              first_due_date=COALESCE(first_due_date, ?),
              billing_cycle_day=COALESCE(billing_cycle_day, ?),
              responsible_name=COALESCE(NULLIF(responsible_name, ''), ?),
              responsible_cpf=COALESCE(NULLIF(responsible_cpf, ''), ?),
              notes=CASE WHEN coalesce(notes, '')='' THEN ? ELSE notes END,
              updated_at=datetime('now')
        WHERE id=?`,
      [
        primaryGuardian?.id || null,
        contract.contract_status && contract.contract_status !== "pending" ? contract.contract_status : "active",
        plan.totalAmount,
        plan.installmentCount,
        plan.firstDueDate,
        plan.billingCycleDay,
        primaryGuardian?.name || null,
        primaryGuardian?.cpf || null,
        "[DEMO] Contrato financeiro preenchido com dados ficticios para validacao operacional.",
        contract.id,
      ]
    );
    contractsUpdated += 1;

    if (!existingInstallments.length) {
      for (const item of plan.items) {
        await run(
          `INSERT INTO financial_installments
             (contract_id, installment_number, due_date, amount, status, paid_at, payment_method, reference_label, notes, metadata_json, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          [
            contract.id,
            item.installmentNumber,
            item.dueDate,
            item.amount,
            item.status,
            item.paidAt,
            item.paymentMethod,
            `Parcela ${item.installmentNumber}/${plan.installmentCount}`,
            "[DEMO] Parcela ficticia criada para simulacao de financeiro.",
            JSON.stringify({ source: "demo_seed" }),
          ]
        );
        installmentsInserted += 1;
      }
    }

    const existingTimeline = await get(
      "SELECT id FROM student_timeline WHERE student_id=? AND contract_id=? AND event_type='financial_plan_seeded' LIMIT 1",
      [contract.student_id, contract.id]
    );
    if (!existingTimeline?.id) {
      await run(
        `INSERT INTO student_timeline
           (student_id, enrollment_id, sales_record_id, contract_id, event_type, title, description, actor_user_id, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          contract.student_id,
          contract.enrollment_id || null,
          contract.sales_record_id || null,
          contract.id,
          "financial_plan_seeded",
          "Plano financeiro de demonstracao criado",
          `Contrato ${contract.contract_number || contract.id} recebeu ${plan.installmentCount} parcela(s) ficticia(s).`,
          actorUserId,
          JSON.stringify({ source: "demo_seed", installments_count: plan.installmentCount }),
        ]
      );
      timelineInserted += 1;
    }
  }

  return { contractsSeen: contracts.length, contractsUpdated, installmentsInserted, timelineInserted };
}

async function ensureAttendanceSeed(actorUserId = null) {
  const sessions = await all(
    `SELECT cs.id AS session_id, cs.class_id, cs.class_schedule_id, cs.class_date,
            ct.user_id AS teacher_user_id
       FROM class_sessions cs
       LEFT JOIN class_teachers ct ON ct.class_id = cs.class_id AND coalesce(ct.is_active, 1) = 1
      WHERE cs.class_date >= date('now', '-21 day')
        AND cs.class_date <= date('now')
        AND lower(coalesce(cs.session_status, '')) IN ('planejada', 'realizada')
        AND EXISTS (SELECT 1 FROM enrollments e WHERE e.class_id = cs.class_id)
      GROUP BY cs.class_id, cs.class_date, cs.id
      ORDER BY cs.class_date DESC, cs.id DESC`
  );

  const pickedByClass = new Map();
  for (const session of sessions) {
    if (!pickedByClass.has(session.class_id)) {
      pickedByClass.set(session.class_id, session);
    }
    if (pickedByClass.size >= 90) break;
  }

  let attendanceInserted = 0;
  let sessionUpdates = 0;
  let timelineInserted = 0;
  for (const session of pickedByClass.values()) {
    await run(
      "UPDATE class_sessions SET session_status='realizada', notes=COALESCE(notes, '[DEMO] Sessao marcada como realizada para validacao.'), updated_at=datetime('now') WHERE id=?",
      [session.session_id]
    );
    sessionUpdates += 1;

    const enrollments = await all(
      `SELECT e.id AS enrollment_id, e.student_id
         FROM enrollments e
        WHERE e.class_id=?
          AND lower(coalesce(e.enrollment_status, '')) NOT IN ('cancelado', 'desistente')
        ORDER BY e.id ASC
        LIMIT 18`,
      [session.class_id]
    );

    for (const enrollment of enrollments) {
      const existing = await get(
        "SELECT id FROM attendance_records WHERE enrollment_id=? AND class_id=? AND coalesce(class_schedule_id, 0)=coalesce(?, 0) AND class_date=? LIMIT 1",
        [enrollment.enrollment_id, session.class_id, session.class_schedule_id || null, session.class_date]
      );
      if (existing?.id) continue;

      const status = pick(ATTENDANCE_STATUSES, enrollment.enrollment_id + session.class_id);
      await run(
        `INSERT INTO attendance_records
           (enrollment_id, class_id, class_schedule_id, class_date, attendance_status, notes, recorded_by_user_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          enrollment.enrollment_id,
          session.class_id,
          session.class_schedule_id || null,
          session.class_date,
          status,
          status === "presente" ? "[DEMO] Frequencia registrada automaticamente." : "[DEMO] Registro ficticio de frequencia.",
          session.teacher_user_id || actorUserId,
        ]
      );
      attendanceInserted += 1;

      const existingTimeline = await get(
        "SELECT id FROM student_timeline WHERE student_id=? AND enrollment_id=? AND event_type='attendance_recorded' AND description=? LIMIT 1",
        [enrollment.student_id, enrollment.enrollment_id, `Frequencia registrada em ${session.class_date}.`]
      );
      if (!existingTimeline?.id) {
        await run(
          `INSERT INTO student_timeline
             (student_id, enrollment_id, event_type, title, description, actor_user_id, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          [
            enrollment.student_id,
            enrollment.enrollment_id,
            "attendance_recorded",
            "Frequencia registrada",
            `Frequencia registrada em ${session.class_date}.`,
            session.teacher_user_id || actorUserId,
            JSON.stringify({ source: "demo_seed", class_id: session.class_id, class_schedule_id: session.class_schedule_id || null, attendance_status: status }),
          ]
        );
        timelineInserted += 1;
      }
    }
  }

  return { sessionsSeeded: pickedByClass.size, sessionUpdates, attendanceInserted, timelineInserted };
}

async function ensureScheduleHistorySeed(actorUserId = null) {
  const candidates = await all(
    `SELECT e.id AS enrollment_id, e.class_id, e.student_id
       FROM enrollments e
      WHERE e.class_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM enrollment_schedule_history h WHERE h.enrollment_id=e.id)
        AND EXISTS (
          SELECT 1
            FROM class_schedules cs
           WHERE cs.class_id = e.class_id
           GROUP BY cs.class_id
          HAVING COUNT(*) >= 2
        )
      ORDER BY e.id ASC
      LIMIT 120`
  );

  let inserted = 0;
  let timelineInserted = 0;
  for (const item of candidates) {
    const schedules = await all(
      "SELECT id, weekday, start_time, end_time, notes FROM class_schedules WHERE class_id=? ORDER BY is_primary DESC, id ASC",
      [item.class_id]
    );
    if (schedules.length < 2) continue;
    const oldSchedule = schedules[0];
    const newSchedule = schedules[1];
    const changedAt = `${addDays(formatDateKey(new Date()), -((item.enrollment_id % 45) + 10))}T15:00:00`;
    await run(
      `INSERT INTO enrollment_schedule_history
         (enrollment_id, old_class_id, new_class_id, old_schedule_snapshot_json, new_schedule_snapshot_json, reason, changed_by_user_id, changed_at, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.enrollment_id,
        item.class_id,
        item.class_id,
        JSON.stringify([oldSchedule]),
        JSON.stringify([newSchedule]),
        "Ajuste de disponibilidade do aluno",
        actorUserId,
        changedAt,
        "[DEMO] Alteracao de horario gerada automaticamente para validacao.",
      ]
    );
    inserted += 1;

    const existingTimeline = await get(
      "SELECT id FROM student_timeline WHERE student_id=? AND enrollment_id=? AND event_type='schedule_change' LIMIT 1",
      [item.student_id, item.enrollment_id]
    );
    if (!existingTimeline?.id) {
      await run(
        `INSERT INTO student_timeline
           (student_id, enrollment_id, event_type, title, description, actor_user_id, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.student_id,
          item.enrollment_id,
          "schedule_change",
          "Mudanca de horario",
          `${oldSchedule.weekday || "Horario"} ${oldSchedule.start_time || ""} -> ${newSchedule.weekday || "Horario"} ${newSchedule.start_time || ""}`.trim(),
          actorUserId,
          JSON.stringify({ source: "demo_seed", old_schedule: oldSchedule, new_schedule: newSchedule }),
          changedAt,
        ]
      );
      timelineInserted += 1;
    }
  }

  return { candidates: candidates.length, inserted, timelineInserted };
}

async function main() {
  await migrate();
  const admin = await get("SELECT id FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1", []);
  const actorUserId = admin?.id || null;

  console.log(`[demo-seed] DB client: ${DB_CLIENT}`);
  const students = await ensureStudentProfileSeed(actorUserId);
  console.log("[demo-seed] students", students);

  const guardians = await ensureGuardianSeed(actorUserId);
  console.log("[demo-seed] guardians", guardians);

  const financial = await ensureFinancialInstallmentSeed(actorUserId);
  console.log("[demo-seed] financial", financial);

  const attendance = await ensureAttendanceSeed(actorUserId);
  console.log("[demo-seed] attendance", attendance);

  const scheduleHistory = await ensureScheduleHistorySeed(actorUserId);
  console.log("[demo-seed] schedule_history", scheduleHistory);

  if (actorUserId) {
    await logEvent(actorUserId, "demo_school_data_seeded", {
      guardians,
      students,
      financial,
      attendance,
      schedule_history: scheduleHistory,
    });
  }
}

main().catch((err) => {
  console.error("[demo-seed] failed", err?.stack || err?.message || err);
  process.exit(1);
});
