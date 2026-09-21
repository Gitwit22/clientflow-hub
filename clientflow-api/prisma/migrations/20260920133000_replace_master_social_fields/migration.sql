-- Replace legacy platform-specific questions on active Master Intake templates only.
WITH candidates AS (
  SELECT
    template."id",
    template."fields",
    EXISTS (
      SELECT 1
      FROM jsonb_array_elements(template."fields") AS field
      WHERE field->>'id' = 'socialLinks'
    ) AS has_social_links,
    (
      SELECT MIN(position)
      FROM jsonb_array_elements(template."fields") WITH ORDINALITY AS field(value, position)
      WHERE field.value->>'id' IN (
        'facebookUrl',
        'instagramUrl',
        'linkedinUrl',
        'tiktokUrl',
        'youtubeUrl'
      )
    ) AS first_social_position
  FROM "CfFormTemplate" AS template
  WHERE template."scope" = 'master_core'
    AND template."isActive" = true
    AND jsonb_typeof(template."fields") = 'array'
),
converted AS (
  SELECT
    candidate."id",
    (
      SELECT jsonb_agg(item.value ORDER BY item.position)
      FROM (
        SELECT field.value, field.position * 2 AS position
        FROM jsonb_array_elements(candidate."fields") WITH ORDINALITY AS field(value, position)
        WHERE field.value->>'id' NOT IN (
          'facebookUrl',
          'instagramUrl',
          'linkedinUrl',
          'tiktokUrl',
          'youtubeUrl'
        )
        UNION ALL
        SELECT
          jsonb_build_object(
            'id', 'socialLinks',
            'label', 'Social media',
            'type', 'social_links',
            'required', false
          ),
          candidate.first_social_position * 2
        WHERE candidate.has_social_links = false
      ) AS item
    ) AS fields
  FROM candidates AS candidate
  WHERE candidate.first_social_position IS NOT NULL
)
UPDATE "CfFormTemplate" AS template
SET
  "fields" = converted.fields,
  "version" = template."version" + 1,
  "updatedAt" = CURRENT_TIMESTAMP
FROM converted
WHERE template."id" = converted."id";
