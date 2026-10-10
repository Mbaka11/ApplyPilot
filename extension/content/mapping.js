// ApplyPilot — règles déterministes « champ → valeur du profil » (FR/EN), + mémoire des réponses.
(() => {
  const AP = globalThis.ApplyPilot;

  const YES = ['Yes', 'Oui'];
  const NO = ['No', 'Non'];
  const PREFER_NOT = [
    'I do not wish to answer',
    "I don't wish to answer",
    'I do not wish to self-identify',
    'I choose not to disclose',
    'I prefer not to answer',
    'Prefer not to say',
    'Prefer not to answer',
    'Decline to self-identify',
    'Decline to answer',
    'I decline to answer',
    'Not declared',
    'Je ne souhaite pas répondre',
    'Je préfère ne pas répondre',
    'Je ne désire pas répondre',
    'Je refuse de répondre',
    'Préfère ne pas répondre',
    'Ne souhaite pas répondre',
  ];

  const CHOICE = ['select', 'radio', 'dropdown', 'prompt', 'combobox', 'checkboxes'];
  const YESNO_KINDS = [...CHOICE, 'checkbox', 'text'];
  const TEXT = ['text', 'textarea', 'combobox'];
  const LETTER_RE = /cover|lettre|motivation|letter/;
  const CV_RE = /resume|\bcv\b|curriculum|\bc v\b/;

  const blank = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
  const val = (value, extra = {}) => (blank(value) ? null : { value, confidence: 0.95, source: 'profil', ...extra });
  const missing = (path) => ({ missing: true, note: `À compléter dans profile.yaml → ${path}` });
  const need = (value, path, extra) => (blank(value) ? missing(path) : val(value, extra));

  function yesNo(b, path) {
    if (b === true) return { value: YES, bool: true, confidence: 0.9, source: 'profil', review: true };
    if (b === false) return { value: NO, bool: false, confidence: 0.9, source: 'profil', review: true };
    return missing(path);
  }

  function preferNot(v, path) {
    if (blank(v)) return missing(path);
    if (/prefer not|ne souhaite|pr[eé]f[eè]re ne pas|decline|non d[eé]clar/i.test(String(v))) {
      return { value: PREFER_NOT, confidence: 0.9, source: 'profil', note: 'Déclaration volontaire : « je ne souhaite pas répondre »' };
    }
    return val(v);
  }

  const isDateish = (d) => ['date', 'date-native'].includes(d.kind) || /\bdate\b|\bmm\b|yyyy|aaaa|\byear\b|\bannee\b/.test(d.sig);

  function langList(c) {
    return (c.p.languages || []).map((l) => (c.lang === 'en' ? l.languageEn || l.language : l.language || l.languageEn)).filter(Boolean);
  }

  function langLevel(c, re) {
    const l = (c.p.languages || []).find((x) => re.test(AP.norm(`${x.language} ${x.languageEn}`)));
    return l ? l.level : undefined;
  }

  // ----- Fichiers -----
  function fileRule(d, c) {
    const near = d.el.closest('section, fieldset, [data-automation-id^="formField"], [data-automation-id$="Section"]');
    const s = `${d.sig} ${AP.norm(d.section)} ${AP.norm(AP.textOf(near).slice(0, 200))}`;
    const { cv, letter } = c.files;
    if (/transcript|releve de notes|bulletin|writing sample|work sample|portfolio/.test(s) && !CV_RE.test(s)) {
      return { missing: true, note: 'Pièce à joindre toi-même (relevé, portfolio…)' };
    }
    if (LETTER_RE.test(s) && !CV_RE.test(s)) {
      return letter ? { value: [letter], confidence: 0.95, source: 'lettre' } : { missing: true, note: 'Génère la lettre de motivation d’abord' };
    }
    const isCv = CV_RE.test(s) || c.platform === 'workday' || c.page.fileInputs.length === 1;
    if (!isCv) return { missing: true, note: 'Pièce jointe non reconnue : à joindre toi-même' };
    if (!cv) return { missing: true, note: 'Aucun CV sélectionné' };
    const files = [cv];
    const wantsLetter = LETTER_RE.test(s) || (d.multiple && c.options.attachLetterWithCv !== false && !c.page.hasLetterInput);
    if (letter && wantsLetter) files.push(letter);
    return { value: files, confidence: 0.95, source: 'cv' };
  }

  // ----- Blocs répétés -----
  function experienceRule(d, c) {
    const e = (c.p.experience || [])[d.entryIndex];
    if (!e) return { skip: true, note: `Pas de ${d.entryIndex + 1}e expérience dans le profil` };
    const s = d.sig;
    const path = `experience[${d.entryIndex}]`;
    if (d.kind === 'checkbox') return /current|actuel|en poste|travaille actuellement/.test(s) ? { value: !!e.current, confidence: 0.95, source: 'profil' } : null;
    if (isDateish(d)) {
      if (/\bfrom\b|start|debut|begin/.test(s) && !/\bend\b|\bfin\b/.test(s)) return need(e.start, `${path}.start`);
      if (/\bto\b|\bend\b|\bfin\b|until|jusqu|expected|actual/.test(s)) return e.current ? { skip: true } : need(e.end, `${path}.end`);
    }
    if (/description|responsibilit|achievement|realisation|taches|duties|summary/.test(s)) return need(e.description, `${path}.description`);
    if (/job ?title|\btitle\b|\bposte\b|\btitre\b|\bfonction\b|\brole\b|position/.test(s)) return need(e.title, `${path}.title`);
    if (/company|employer|employeur|entreprise|organi[sz]ation|societe/.test(s)) return need(e.company, `${path}.company`);
    if (/location|\blieu\b|\bcity\b|\bville\b/.test(s)) return need(e.location, `${path}.location`);
    return null;
  }

  function educationRule(d, c) {
    const e = (c.p.education || [])[d.entryIndex];
    if (!e) return { skip: true, note: `Pas de ${d.entryIndex + 1}e formation dans le profil` };
    const s = d.sig;
    const path = `education[${d.entryIndex}]`;
    if (isDateish(d) || /year|annee/.test(s)) {
      if (/\bfrom\b|start|debut|first year|begin/.test(s) && !/\bend\b|\bfin\b/.test(s)) return need(e.start, `${path}.start`);
      if (/\bto\b|\bend\b|\bfin\b|last year|expected|actual|graduat/.test(s)) return need(e.end, `${path}.end`);
    }
    if (/school|university|universite|college|etablissement|institution|ecole/.test(s)) return need(e.school, `${path}.school`, { alts: e.schoolSearch });
    if (/degree|diplome|niveau/.test(s)) return need(e.degreeEn || e.degree, `${path}.degree`, { alts: [...(e.degreeLevel || []), e.degree] });
    if (/field of study|major|discipline|domaine|program|speciali|concentration/.test(s)) {
      return need(e.fieldOfStudy, `${path}.fieldOfStudy`, { alts: e.fieldOfStudySearch });
    }
    if (/gpa|grade|moyenne|overall result|\bcote\b|result/.test(s)) return blank(e.gpa) ? { skip: true } : val(e.gpa);
    if (/location|lieu|city|ville/.test(s)) return blank(e.location) ? { skip: true } : val(e.location);
    return null;
  }

  const R = (id, test, fn, opts = {}) => ({ id, test, fn, ...opts });

  const RULES = [
    R('never', /password|mot de passe|captcha|signature|initials|initiales/, () => ({ skip: true })),
    R('consent', /\b(i )?(agree|accept|acknowledge|consent|certify|confirm|have read|understand)\b|j ?accepte|je (certifie|confirme|consens|reconnais|comprends)|terms|conditions|privacy|confidentialite|politique|attest/,
      () => ({ skip: true, status: 'check', note: 'Consentement : à lire et cocher toi-même' }), { kinds: ['checkbox'] }),
    R('coverLetterText', /cover ?letter|lettre (de )?(motivation|presentation)|motivation letter|letter of (motivation|interest|intent)/,
      (d, c) => (c.letterText ? { value: c.letterText, confidence: 0.95, source: 'lettre' } : { missing: true, note: 'Génère la lettre d’abord' }), { kinds: TEXT }),
    R('experience', null, experienceRule, { when: (d) => d.entryType === 'experience', stop: true }),
    R('education', null, educationRule, { when: (d) => d.entryType === 'education', stop: true }),

    // Identité
    R('preferredNameCheck', /preferred name|nom prefere|prenom usuel/, (d, c) => ({ value: !blank(c.p.identity?.preferredName), confidence: 0.9, source: 'profil' }), { kinds: ['checkbox'] }),
    R('preferredName', /preferred|prefere|nickname|surnom|usuel/, (d, c) => (blank(c.p.identity?.preferredName) ? { skip: true } : val(c.p.identity.preferredName)), { kinds: ['text'] }),
    R('middleName', /middle|second prenom|autre prenom/, () => ({ skip: true }), { kinds: ['text'] }),
    R('firstName', /\b(first|given) ?names?\b|\bprenoms?\b|\bfname\b/, (d, c) => need(c.p.identity?.firstName, 'identity.firstName'), { kinds: ['text'] }),
    R('lastName', /\b(last|family) ?names?\b|\bsurname\b|nom de famille|\blname\b/, (d, c) => need(c.p.identity?.lastName, 'identity.lastName'), { kinds: ['text'] }),
    R('fullName', null,
      (d, c) => (d.labelNorm === 'nom' && c.page.hasFirstName ? need(c.p.identity?.lastName, 'identity.lastName') : need(c.fullName, 'identity.firstName')),
      { kinds: ['text'], labelTest: /^(full ?name|name|nom|nom complet|your name|votre nom|legal name|nom legal|nom et prenom|prenom et nom|candidate name|nom du candidat)$/ }),

    // Contact
    R('email', /e ?mail|courriel|adresse electronique/, (d, c) => need(c.p.identity?.email, 'identity.email'), { kinds: ['text'] }),
    R('phoneType', /(phone|telephone).{0,12}(type|device)|device type|type de (telephone|numero|appareil)/,
      (d, c) => val(c.p.identity?.phoneType || 'Mobile', { alts: ['Mobile', 'Cellulaire', 'Cell', 'Mobile Phone', 'Cellular', 'Personal Mobile'] })),
    R('phoneCode', /country (phone )?code|phone code|indicatif|calling code|code (du )?pays/, (d, c) => {
      const code = c.p.identity?.phoneCountryCode || '+1';
      const country = c.p.identity?.phoneCountry || 'Canada';
      return d.kind === 'text' ? val(code) : val(`${country} (${code})`, { alts: [country, code] });
    }),
    R('phoneExt', /\bext(ension)?\b|\bposte telephonique\b/, () => ({ skip: true }), { kinds: ['text'] }),
    R('phone', /phone|telephone|mobile|\bcell|\btel\b|numero de tel/, (d, c) => {
      const ph = c.p.identity?.phone;
      if (blank(ph)) return missing('identity.phone');
      return val(c.page.hasPhoneCode || c.platform === 'workday' ? ph : `${c.p.identity?.phoneCountryCode || '+1'} ${ph}`);
    }, { kinds: ['text'] }),

    // Adresse
    R('addr2', /address ?line ?2|adresse (ligne )?2|\bapt\b|appartement|\bsuite\b|\bunit\b|address 2|complement d ?adresse/,
      (d, c) => (blank(c.addr.line2) ? { skip: true } : val(c.addr.line2)), { kinds: ['text'] }),
    R('addr1', /address ?line ?1|street|\brue\b|adresse (ligne )?1|adresse postale|adresse civique|mailing address|home address|address 1/,
      (d, c) => need(c.addr.line1, 'identity.address.line1'), { kinds: ['text', 'textarea'], labelTest: /^(address|adresse|adresse civique|street address|adresse postale)$/ }),
    R('city', /\bcity\b|\bville\b|municipalit|\btown\b|locality|localite/, (d, c) => need(c.addr.city, 'identity.address.city')),
    R('postal', /postal|\bzip\b|postcode/, (d, c) => need(c.addr.postalCode, 'identity.address.postalCode'), { kinds: ['text'] }),
    R('province', /province|\bstate\b|\bregion\b|territor|\betat\b/, (d, c) => need(c.addr.province, 'identity.address.province', { alts: [c.addr.provinceCode].filter(Boolean) }),
      { notTest: /united states|etats unis/ }),
    R('citizenship', /citizenship|citoyennete|nationalit/, (d, c) => need(c.p.workAuthorization?.citizenship, 'workAuthorization.citizenship')),
    R('country', /\bcountry\b|\bpays\b/, (d, c) => need(c.addr.country || 'Canada', 'identity.address.country'), { notTest: /phone|code|indicatif|birth|naissance/ }),

    // Liens
    R('linkedin', /linked ?in/, (d, c) => need(c.p.links?.linkedin, 'links.linkedin'), { kinds: ['text'] }),
    R('github', /git ?hub|gitlab/, (d, c) => need(c.p.links?.github, 'links.github'), { kinds: ['text'] }),
    R('social', /twitter|facebook|instagram|tiktok/, () => ({ skip: true }), { kinds: ['text'] }),
    R('website', /portfolio|website|site web|site internet|personal (url|site|page)|\burl\b|blog/, (d, c) => need(c.p.links?.portfolio || c.p.links?.github, 'links.portfolio'), { kinds: ['text'] }),

    // Admissibilité (oui / non)
    R('workAuthWithout', /(without|sans) .{0,25}(sponsor|parrain|visa)/, (d, c) => {
      const a = c.authFor(d);
      const v = a.authorizedToWork === true && a.needsSponsorship === false ? true : a.authorizedToWork === false || a.needsSponsorship === true ? false : null;
      return yesNo(v, `workAuthorization.${c.authKey(d)}`);
    }, { kinds: YESNO_KINDS }),
    R('sponsorship', /sponsor|parrain|\bvisa\b|immigration (support|assistance)|require .{0,30}(permit|work authori)|besoin .{0,30}permis/,
      (d, c) => yesNo(c.authFor(d).needsSponsorship, `workAuthorization.${c.authKey(d)}.needsSponsorship`), { kinds: YESNO_KINDS }),
    R('workAuth', /(authori[sz]ed|eligible|entitled|permitted|allowed|legally able) to work|right to work|autorise(e)? a travailler|admissible a travailler|droit de travailler|legalement (autorise|admissible)|permis de travail|work permit|work authori[sz]ation|eligib.{0,20}(work|travail)/,
      (d, c) => yesNo(c.authFor(d).authorizedToWork, `workAuthorization.${c.authKey(d)}.authorizedToWork`), { kinds: YESNO_KINDS }),
    R('over18', /18 (years|ans)|age of (majority|18)|at least 18|\bmajeur|18 or older|legal age|age legal/, (d, c) => yesNo(c.p.standardAnswers?.over18 ?? true, 'standardAnswers.over18'), { kinds: YESNO_KINDS }),
    R('previousWorker', /previously (been )?(employed|worked)|have you (ever )?(been employed|worked) (by|for|at)|worked (for|at) .{0,40}(before|previously|in the past)|already worked|ancien(ne)? (employe|travailleur)|deja (travaille|ete employe)|former (employee|worker)|previous worker|current or former|actuel(le)? ou ancien/,
      (d, c) => {
        const prev = c.workedAtCompany;
        return { value: prev ? YES : NO, bool: !!prev, confidence: 0.8, source: 'profil', review: true, note: prev ? `Tu as travaillé chez ${prev}` : 'Aucune expérience dans cette entreprise selon ton profil' };
      }, { kinds: YESNO_KINDS }),
    R('enrolled', /currently (enrolled|a student|attending|registered|pursuing)|etudiant(e)? (actuellement|a temps plein)|actuellement (inscrit|aux etudes|etudiant)|inscrit(e)? (a|dans) un programme|full ?time student|are you a student|etes vous (un )?etudiant/,
      (d, c) => yesNo(c.p.student?.currentlyEnrolled, 'student.currentlyEnrolled'), { kinds: YESNO_KINDS }),
    R('returning', /return(ing)? to (school|studies|your studies|university)|retour(ner)? aux etudes|poursuivre (vos|tes) etudes|continue (your )?(studies|education)/,
      (d, c) => yesNo(c.p.student?.returningToSchoolAfterInternship, 'student.returningToSchoolAfterInternship'), { kinds: YESNO_KINDS }),
    R('relocate', /relocat|demenag|willing to move|prepared to move/, (d, c) => yesNo(c.p.availability?.willingToRelocate, 'availability.willingToRelocate'), { kinds: YESNO_KINDS }),
    R('relatives', /relative|family member|lien de parente|membre de (votre|ta|la) famille|related to (an|any) (employee|staff)/,
      (d, c) => yesNo(c.p.standardAnswers?.relativesAtCompany, 'standardAnswers.relativesAtCompany'), { kinds: YESNO_KINDS }),
    R('noncompete', /non ?compet|non ?concurrence|restrictive covenant|clause restrictive/, (d, c) => yesNo(c.p.standardAnswers?.nonCompete, 'standardAnswers.nonCompete'), { kinds: YESNO_KINDS }),
    R('conflict', /conflict of interest|conflit d ?interet/, (d, c) => yesNo(c.p.standardAnswers?.conflictOfInterest, 'standardAnswers.conflictOfInterest'), { kinds: YESNO_KINDS }),
    R('travel', /willing to travel|travel (required|requirement)|deplacements?/, (d, c) => yesNo(c.p.standardAnswers?.willingToTravel, 'standardAnswers.willingToTravel'), { kinds: YESNO_KINDS }),

    // Source / rémunération
    R('source', /how did you (hear|learn|find)|where did you (hear|see|find)|comment avez vous (entendu|connu|appris|trouve)|ou avez vous (vu|trouve|entendu)|how .{0,20}(hear|learn).{0,20}(about|of) (us|this)|\bsource\b|referral source/,
      (d, c) => val(c.p.preferences?.howDidYouHear || 'LinkedIn', { alts: c.p.preferences?.howDidYouHearAlternatives || [] })),
    R('referral', /referr(ed|al) (by|name)|employee referral|refere par|recommande par|nom (du|de la) (referent|personne)/,
      (d, c) => (blank(c.p.preferences?.referral) ? { skip: true } : val(c.p.preferences.referral)), { kinds: ['text'] }),
    R('salary', /salary|salaire|compensation|remuneration|pay (expectation|range)|attentes salariales|taux horaire|hourly rate|desired pay/,
      (d, c) => (blank(c.p.preferences?.salaryExpectation) ? { missing: true, note: 'Salaire : à remplir toi-même (ou preferences.salaryExpectation)' } : val(c.p.preferences.salaryExpectation))),

    // Études (questions isolées)
    R('school', /school|university|universite|college|etablissement|institution|\becole\b/, (d, c) => (c.edu0 ? need(c.edu0.school, 'education[0].school', { alts: c.edu0.schoolSearch }) : missing('education')),
      { notTest: /high school|secondaire/ }),
    R('degree', /degree|diplome|niveau d ?etudes|education level|level of education|highest (level|education)|cycle d ?etudes/,
      (d, c) => (c.edu0 ? val(c.edu0.degreeEn || c.edu0.degree, { alts: [...(c.edu0.degreeLevel || []), c.edu0.degree] }) : missing('education'))),
    R('field', /field of study|\bmajor\b|discipline|program of study|domaine d ?etudes|speciali[sz]ation|concentration|area of study/,
      (d, c) => (c.edu0 ? need(c.edu0.fieldOfStudy, 'education[0].fieldOfStudy', { alts: c.edu0.fieldOfStudySearch }) : missing('education'))),
    R('gpa', /\bgpa\b|grade point|moyenne|cumulative average|\bcote\b|overall result/, (d, c) => (blank(c.edu0?.gpa) ? missing('education[0].gpa') : val(c.edu0.gpa)), { kinds: ['text'] }),
    R('graduation', /graduat|diplomation|expected (completion|graduation|end)|fin (des|de vos) etudes|date de fin d ?etudes|obtention du diplome/,
      (d, c) => need(c.p.student?.expectedGraduation, 'student.expectedGraduation')),

    // Disponibilités
    R('startDate', /start date|date de debut|available (to start|from|starting)|availability date|disponible a partir|earliest (start|date)|when can you start|date d ?entree/,
      (d, c) => need(c.p.availability?.startDate, 'availability.startDate')),
    R('term', /\bterm\b|\bsession\b|trimestre|semester|which (internship )?period|periode de stage|work term/,
      (d, c) => need(c.lang === 'en' ? c.p.availability?.termEn || c.p.availability?.term : c.p.availability?.term, 'availability.term', {
        alts: [c.p.availability?.term, c.p.availability?.termEn].filter(Boolean),
      }), { notTest: /long term|term(s)? (and|&) conditions|terme/ }),
    R('duration', /duration|\bduree\b|how many (months|weeks)|nombre de (mois|semaines)|length of (the )?internship/, (d, c) => need(c.p.availability?.durationMonths, 'availability.durationMonths')),

    // Langues
    R('frenchLevel', /(level|niveau|proficiency|maitrise|competence|fluency).{0,30}(french|francais)|(french|francais).{0,30}(level|niveau|proficiency|fluency)/,
      (d, c) => need(langLevel(c, /francais|french/), 'languages[Français].level')),
    R('englishLevel', /(level|niveau|proficiency|maitrise|competence|fluency).{0,30}(english|anglais)|(english|anglais).{0,30}(level|niveau|proficiency|fluency)/,
      (d, c) => need(langLevel(c, /anglais|english/), 'languages[Anglais].level')),
    R('languages', /languages? (spoken|you speak)|langues? parlees|which languages|quelles langues/,
      (d, c) => {
        const l = langList(c);
        if (!l.length) return missing('languages');
        return CHOICE.includes(d.kind) ? val(l, { multi: true }) : val(l.join(', '));
      }, { labelTest: /^(languages?|langues?|languages spoken|langues parlees)$/ }),

    // Déclarations volontaires
    R('gender', /\bgender\b|\bgenre\b|\bsexe\b|\bsex\b|identite de genre/, (d, c) => preferNot(c.vd.gender, 'voluntaryDisclosures.gender')),
    R('pronouns', /pronoun|pronom/, (d, c) => preferNot(c.vd.pronouns, 'voluntaryDisclosures.pronouns')),
    R('indigenous', /indigenous|aboriginal|autochtone|first nations|premieres nations|metis|inuit/, (d, c) => preferNot(c.vd.indigenous, 'voluntaryDisclosures.indigenous')),
    R('visibleMinority', /visible minority|minorite visible|racialized|racise/, (d, c) => preferNot(c.vd.visibleMinority, 'voluntaryDisclosures.visibleMinority')),
    R('ethnicity', /ethnic|\brace\b|racial|origine ethnique|ethnicite|hispanic|latino/, (d, c) => preferNot(c.vd.ethnicity, 'voluntaryDisclosures.ethnicity')),
    R('disability', /disabilit|handicap|limitation fonctionnelle/, (d, c) => preferNot(c.vd.disability, 'voluntaryDisclosures.disability')),
    R('veteran', /veteran|military|militaire|ancien combattant|armed forces|forces armees/, (d, c) => preferNot(c.vd.veteran, 'voluntaryDisclosures.veteran')),
    R('orientation', /sexual orientation|orientation sexuelle|lgbt/, (d, c) => preferNot(c.vd.sexualOrientation, 'voluntaryDisclosures.sexualOrientation')),

    // Compétences
    R('skills', /\bskills?\b|competences|technologies|outils maitrises/, (d, c) => {
      const s = c.p.skills || [];
      if (!s.length) return missing('skills');
      return d.kind === 'prompt' || d.kind === 'checkboxes' ? val(s.slice(0, 12), { multi: true, review: true }) : val(s.join(', '));
    }, { kinds: ['prompt', 'checkboxes', 'text', 'textarea'] }),
  ];

  /** Règles dont la valeur vient du profil et ne doit pas être remplacée par la mémoire. */
  const NO_MEMORY = new Set([
    'never', 'consent', 'coverLetterText', 'experience', 'education', 'file', 'preferredName', 'preferredNameCheck', 'middleName',
    'firstName', 'lastName', 'fullName', 'email', 'phone', 'phoneExt', 'addr1', 'addr2', 'city', 'postal', 'linkedin', 'github',
    'social', 'website', 'school', 'degree', 'field', 'gpa', 'skills',
  ]);

  function matches(rule, d) {
    if (rule.kinds && !rule.kinds.includes(d.kind)) return false;
    if (rule.when && !rule.when(d)) return false;
    if (!rule.test && !rule.labelTest) return !!rule.when;
    const hit = (rule.test && rule.test.test(d.sig)) || (rule.labelTest && rule.labelTest.test(d.labelNorm));
    return hit && !(rule.notTest && rule.notTest.test(d.sig));
  }

  const memoryKey = (label) => AP.norm(label).replace(/\s+/g, ' ').slice(0, 200);

  function memoryLookup(d, c) {
    if (!d.label || d.kind === 'file' || d.kind === 'textarea') return null;
    const m = c.memory[memoryKey(d.label)];
    if (!m || m.value === undefined || m.value === null || m.value === '') return null;
    return { value: m.value, multi: Array.isArray(m.value), bool: typeof m.value === 'boolean' ? m.value : undefined, confidence: 0.85, source: 'mémoire', note: 'Réponse mémorisée', ruleId: 'memory' };
  }

  /** Valeur à mettre dans un champ, ou null si aucune règle ne s'applique (→ IA). */
  function resolve(d, c) {
    if (d.kind === 'file') return { ...fileRule(d, c), ruleId: 'file' };
    let res = null;
    let rule = null;
    for (const r of RULES) {
      if (!matches(r, d)) continue;
      const out = r.fn(d, c);
      if (out) {
        res = out;
        rule = r;
        break;
      }
      if (r.stop) break;
    }
    if (!(rule && NO_MEMORY.has(rule.id))) {
      const mem = memoryLookup(d, c);
      if (mem) return mem;
    }
    return res ? { ...res, ruleId: rule.id } : null;
  }

  function workedAt(p, company) {
    const c = AP.norm(company || '');
    if (c.length < 2) return null;
    for (const e of p.experience || []) {
      for (const name of [e.company, ...(e.companyAliases || [])].filter(Boolean)) {
        const n = AP.norm(name);
        if (n && (` ${c} `.includes(` ${n} `) || ` ${n} `.includes(` ${c} `))) return e.company;
      }
    }
    return null;
  }

  function makeContext(payload = {}) {
    const p = payload.profile || {};
    const id = p.identity || {};
    const job = payload.job || {};
    const ctx = {
      p,
      job,
      platform: payload.platform || AP.platform(),
      addr: id.address || {},
      vd: p.voluntaryDisclosures || {},
      edu0: (p.education || [])[0] || null,
      fullName: [id.firstName, id.lastName].filter(Boolean).join(' '),
      letterText: payload.letterText || '',
      files: payload.files || {},
      memory: payload.memory?.items || {},
      options: payload.options || {},
      lang: job.language || AP.detectLanguage((document.body?.innerText || '').slice(0, 4000)),
      page: { fileInputs: [] },
    };
    ctx.workedAtCompany = workedAt(p, job.company || job.companyGuess);
    ctx.authKey = (d) => (/united states|\bu s\b|\busa\b|etats unis|americ/.test(d.sig) ? 'us' : 'canada');
    ctx.authFor = (d) => (p.workAuthorization || {})[ctx.authKey(d)] || {};
    return ctx;
  }

  function computePageFlags(ctx, fields) {
    ctx.page.hasFirstName = fields.some((f) => /\b(first|given) ?names?\b|\bprenoms?\b/.test(f.sig));
    ctx.page.hasPhoneCode = fields.some((f) => /country (phone )?code|phone code|indicatif|calling code/.test(f.sig));
    ctx.page.fileInputs = fields.filter((f) => f.kind === 'file');
    ctx.page.hasLetterInput = ctx.page.fileInputs.some((f) => LETTER_RE.test(`${f.sig} ${AP.norm(f.section)}`) && !CV_RE.test(f.sig));
  }

  Object.assign(AP, { resolve, makeContext, computePageFlags, memoryKey, NO_MEMORY, YES, NO, PREFER_NOT });
})();
