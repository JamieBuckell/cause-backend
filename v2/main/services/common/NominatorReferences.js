const Dynamo = require("./Dynamo");
const Functions = require("./Functions");

// Reservations live outside the campaign partition, so they do not appear in
// campaign data. Keep them after failures/deletion: reusing a reference could
// make historical family references ambiguous. The same owner can retry.
async function allocate({ campaignId, organisationId, owner, name, currentReference, rows, tableName }) {
  const used = new Set(rows.filter((row) =>
    row.PK === campaignId && row.GSI3PK === organisationId &&
    row.SK !== owner && (row.type === "nominator" || row.type === "team-lead")
  ).map((row) => row.nominatorDetails?.reference).filter(Boolean));
  const initials = Functions.getUsersUniqueReference(name);
  if (!initials) throw new Error("Cannot allocate a nominator reference without initials");

  const claim = async (reference) => !used.has(reference) &&
    await Dynamo.reserveNominatorReference({ campaignId, organisationId, reference, owner }, tableName);

  if (currentReference && await claim(currentReference)) return currentReference;
  // Preserve the established suffix convention: JA, JAB, JAC, ...
  for (let suffix = 1; ; suffix++) {
    const reference = suffix === 1 ? initials : initials + Functions.numToSSColumn(suffix);
    if (reference !== currentReference && await claim(reference)) return reference;
  }
}

async function repair(nominator, rows, tableName) {
  const details = nominator.nominatorDetails;
  const reference = await allocate({
    campaignId: nominator.PK,
    organisationId: nominator.GSI3PK,
    owner: nominator.SK,
    name: `${details.firstName || ""} ${details.lastName || ""}`.trim() || details.reference,
    currentReference: details.reference,
    rows,
    tableName,
  });
  if (reference !== details.reference) {
    const updated = { ...nominator, nominatorDetails: { ...details, reference } };
    await Dynamo.write(updated, tableName);
    nominator.nominatorDetails = updated.nominatorDetails;
  }
  return reference;
}

module.exports = { allocate, repair };
