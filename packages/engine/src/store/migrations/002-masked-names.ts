/** Clears the masked-number placeholders (`+40∙∙∙∙∙∙∙50`) earlier ingests stored as names. */
export const CLEAR_MASKED_NAMES = /* sql */ `
UPDATE contacts SET name = NULL
WHERE name GLOB '+[0-9]*[0-9]' AND instr(name, char(0x2219)) > 0
  AND ltrim(name, '+0123456789' || char(0x2219)) = '';
UPDATE chats SET name = NULL
WHERE name GLOB '+[0-9]*[0-9]' AND instr(name, char(0x2219)) > 0
  AND ltrim(name, '+0123456789' || char(0x2219)) = '';
`;
