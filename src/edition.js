// ─────────────────────────────────────────────────────────────────────────────
//  Which edition this build is. Penteint Projects is a fork of Trawpie (the free education
//  edition). The education-only parts — the Dissertation workspace, free Pro Education for
//  university emails, Literature on by default — stay in the code so fixes still merge across
//  from Trawpie, but this switch turns them off. firestore.rules has the same switch
//  (function education()); tests/unit.test.mjs checks the two agree.
// ─────────────────────────────────────────────────────────────────────────────
export const EDITION = 'projects';
export const EDUCATION = false;
