-- Scope the existing global tag catalogue to investigations without losing
-- reusable tags or event assignments. Existing tags are copied to every case,
-- matching their former global availability.
ALTER TABLE "Tag"
ADD COLUMN "caseId" TEXT,
ADD COLUMN "normalizedName" TEXT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Tag") AND NOT EXISTS (SELECT 1 FROM "Case") THEN
    RAISE EXCEPTION 'Cannot scope legacy tags because no investigation case exists';
  END IF;
END $$;

UPDATE "Tag" AS tag
SET
  "caseId" = owner."id",
  "normalizedName" = lower(regexp_replace(trim(tag."name"), '\s+', ' ', 'g'))
FROM (
  SELECT "id"
  FROM "Case"
  ORDER BY "createdAt", "id"
  LIMIT 1
) AS owner;

INSERT INTO "Tag" ("id", "caseId", "name", "normalizedName", "colour")
SELECT
  tag."id" || '_case_' || md5(investigation."id"),
  investigation."id",
  tag."name",
  tag."normalizedName",
  tag."colour"
FROM "Tag" AS tag
CROSS JOIN "Case" AS investigation
WHERE investigation."id" <> tag."caseId";

UPDATE "EventTag" AS assignment
SET "tagId" = assignment."tagId" || '_case_' || md5(event."caseId")
FROM "Event" AS event, "Tag" AS original
WHERE assignment."eventId" = event."id"
  AND assignment."tagId" = original."id"
  AND original."caseId" <> event."caseId";

-- Older global catalogues could contain names which only differ by case or
-- surrounding whitespace. Merge those concepts per case while retaining every
-- assignment, then enforce the new normalised uniqueness rule.
CREATE TEMP TABLE "_TagMerge" ON COMMIT DROP AS
SELECT
  "id" AS "oldId",
  first_value("id") OVER (
    PARTITION BY "caseId", "normalizedName"
    ORDER BY "id"
  ) AS "canonicalId"
FROM "Tag";

INSERT INTO "EventTag" ("eventId", "tagId")
SELECT assignment."eventId", mapping."canonicalId"
FROM "EventTag" AS assignment
JOIN "_TagMerge" AS mapping ON mapping."oldId" = assignment."tagId"
ON CONFLICT ("eventId", "tagId") DO NOTHING;

DELETE FROM "EventTag" AS assignment
USING "_TagMerge" AS mapping
WHERE assignment."tagId" = mapping."oldId"
  AND mapping."oldId" <> mapping."canonicalId";

DELETE FROM "Tag" AS tag
USING "_TagMerge" AS mapping
WHERE tag."id" = mapping."oldId"
  AND mapping."oldId" <> mapping."canonicalId";

ALTER TABLE "Tag"
ALTER COLUMN "caseId" SET NOT NULL,
ALTER COLUMN "normalizedName" SET NOT NULL;

DROP INDEX "Tag_name_key";

CREATE UNIQUE INDEX "Tag_caseId_normalizedName_key"
ON "Tag"("caseId", "normalizedName");

CREATE INDEX "Tag_caseId_name_idx" ON "Tag"("caseId", "name");
CREATE INDEX "EventTag_tagId_idx" ON "EventTag"("tagId");

ALTER TABLE "Tag"
ADD CONSTRAINT "Tag_caseId_fkey"
FOREIGN KEY ("caseId") REFERENCES "Case"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DocumentTag" (
  "documentId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,

  CONSTRAINT "DocumentTag_pkey" PRIMARY KEY ("documentId", "tagId")
);

CREATE INDEX "DocumentTag_tagId_idx" ON "DocumentTag"("tagId");

ALTER TABLE "DocumentTag"
ADD CONSTRAINT "DocumentTag_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "Document"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentTag"
ADD CONSTRAINT "DocumentTag_tagId_fkey"
FOREIGN KEY ("tagId") REFERENCES "Tag"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
