export type LandingLang = "en" | "fr";

export interface LandingCopy {
  htmlLang: string;
  metaTitle: string;
  metaDescription: string;
  nav: { features: string; screenshots: string; openApp: string; github: string };
  hero: {
    h1a: string;
    h1b: string;
    h1prod: string;
    sub: string;
    ctaPrimary: string;
    ctaSecondary: string;
    stars: string;
  };
  quote: { before: string; highlight: string; after: string };
  features: {
    eyebrow: string;
    title: string;
    items: { icon: string; tone: string; title: string; body: string }[];
  };
  showcase: {
    rows: { eyebrow: string; tone: string; title: string; body: string; img: string; alt: string }[];
  };
  finalCta: { title: string; body: string; primary: string; secondary: string };
  footer: { license: string; github: string; openApp: string };
  langSwitch: { label: string; href: string };
}

export const LANDING_COPY: Record<LandingLang, LandingCopy> = {
  en: {
    htmlLang: "en",
    metaTitle: "Overlook — the database editor that can't lie to you about prod",
    metaDescription:
      "An open-source, 100% web database editor with the UI/UX of a Notion-style tool — built around one rule: you should never be able to mistake a local database for a production one.",
    nav: { features: "Features", screenshots: "Screenshots", openApp: "Open the app", github: "GitHub" },
    hero: {
      h1a: "The database editor that",
      h1b: "can't lie to you about",
      h1prod: "prod",
      sub:
        "Overlook is a free, open-source, 100% web database editor with the UI/UX of a Notion-style tool — built around one rule: you should never be able to mistake a local database for a production one.",
      ctaPrimary: "View on GitHub",
      ctaSecondary: "Open the app →",
      stars: "MIT licensed · Next.js · Postgres / MySQL / SQLite",
    },
    quote: {
      before: "One misclick against the wrong connection shouldn't be able to ",
      highlight: "take down production.",
      after:
        " So the app makes that connection impossible to miss — and impossible to act on by accident.",
    },
    features: {
      eyebrow: "What's inside",
      title: "Everything a database GUI should have —\nplus the guardrails it usually skips",
      items: [
        { icon: "◈", tone: "var(--dev)", title: "Multiple connections", body: "PostgreSQL, MySQL, and SQLite side by side — each tagged Local, Dev, Staging, Prod, or Custom." },
        { icon: "▲", tone: "var(--prod)", title: "Production guardrails", body: "Dropping a column, deleting a row, or running a write query on a prod connection requires typing the connection's name to confirm." },
        { icon: "▦", tone: "var(--local)", title: "4 views per table", body: "Table, Board, Calendar, and Gallery — with filters, sorting, and grouping built in." },
        { icon: "⌘", tone: "var(--staging)", title: "Command palette", body: "⌘K to jump anywhere — tables, connections, actions — without leaving the keyboard." },
        { icon: "↺", tone: "var(--dev)", title: "History with undo", body: "Every edit is tracked. Made a mistake in a non-prod table? Roll it back in one click." },
        { icon: "⇄", tone: "var(--local)", title: "Import & export", body: "CSV import, SQL/NDJSON export, and a read-only-by-default SQL console for ad-hoc queries." },
      ],
    },
    showcase: {
      rows: [
        {
          eyebrow: "Production guardrail",
          tone: "var(--prod)",
          title: "Confirm by typing the connection's name",
          body: "On any connection tagged \"prod,\" destructive actions — deleting a row, dropping or altering a column, running a raw write query — are blocked until you type the connection's name. The schema panel is read-only by default.",
          img: "/landing/prod-guard.png",
          alt: "Production guardrail confirmation dialog",
        },
        {
          eyebrow: "Command palette",
          tone: "var(--dev)",
          title: "⌘K to go anywhere",
          body: "Jump between connections and tables, switch views, or trigger an action without touching the mouse. Built for people who live in their editor.",
          img: "/landing/command-palette.png",
          alt: "Command palette",
        },
        {
          eyebrow: "Gallery view",
          tone: "var(--local)",
          title: "Four views, one table",
          body: "Table, Board, Calendar, and Gallery views share the same filters, sorts, and groups — switch perspective without losing your place.",
          img: "/landing/gallery-view.png",
          alt: "Gallery view",
        },
      ],
    },
    finalCta: {
      title: "Free. Open-source. Self-hosted.",
      body: "Clone it, point it at your database, and never mix up an environment again.",
      primary: "Star on GitHub",
      secondary: "Open the app →",
    },
    footer: { license: "Overlook contributors · MIT License", github: "GitHub", openApp: "Open the app" },
    langSwitch: { label: "FR", href: "/landing/fr" },
  },
  fr: {
    htmlLang: "fr",
    metaTitle: "Overlook — l'éditeur de base de données qui ne peut pas vous mentir sur la prod",
    metaDescription:
      "Un éditeur de base de données open-source, 100% web, avec l'UI/UX d'un outil façon Notion — construit autour d'une seule règle : vous ne devriez jamais pouvoir confondre une base locale avec une base de production.",
    nav: { features: "Fonctionnalités", screenshots: "Captures d'écran", openApp: "Ouvrir l'app", github: "GitHub" },
    hero: {
      h1a: "L'éditeur de base de données",
      h1b: "qui ne peut pas vous mentir sur la",
      h1prod: "prod",
      sub:
        "Overlook est un éditeur de base de données gratuit, open-source, 100% web, avec l'UI/UX d'un outil façon Notion — construit autour d'une seule règle : vous ne devriez jamais pouvoir confondre une base locale avec une base de production.",
      ctaPrimary: "Voir sur GitHub",
      ctaSecondary: "Ouvrir l'app →",
      stars: "Licence MIT · Next.js · Postgres / MySQL / SQLite",
    },
    quote: {
      before: "Un simple clic sur la mauvaise connexion ne devrait jamais pouvoir ",
      highlight: "faire tomber la production.",
      after:
        " L'app rend donc cette connexion impossible à manquer — et impossible à toucher par accident.",
    },
    features: {
      eyebrow: "Au menu",
      title: "Tout ce qu'un éditeur de base de données doit avoir —\net les garde-fous qu'il n'a généralement pas",
      items: [
        { icon: "◈", tone: "var(--dev)", title: "Connexions multiples", body: "PostgreSQL, MySQL et SQLite côte à côte — chacune taguée Local, Dev, Staging, Prod ou Custom." },
        { icon: "▲", tone: "var(--prod)", title: "Garde-fous production", body: "Supprimer une colonne, une ligne, ou lancer une requête d'écriture sur une connexion prod exige de taper le nom de la connexion pour confirmer." },
        { icon: "▦", tone: "var(--local)", title: "4 vues par table", body: "Table, Board, Calendrier et Galerie — avec filtres, tri et regroupement intégrés." },
        { icon: "⌘", tone: "var(--staging)", title: "Palette de commandes", body: "⌘K pour naviguer partout — tables, connexions, actions — sans lâcher le clavier." },
        { icon: "↺", tone: "var(--dev)", title: "Historique avec annulation", body: "Chaque modification est tracée. Une erreur sur une table non-prod ? Annulez-la en un clic." },
        { icon: "⇄", tone: "var(--local)", title: "Import & export", body: "Import CSV, export SQL/NDJSON, et une console SQL en lecture seule par défaut pour vos requêtes ponctuelles." },
      ],
    },
    showcase: {
      rows: [
        {
          eyebrow: "Garde-fou production",
          tone: "var(--prod)",
          title: "Confirmation en tapant le nom de la connexion",
          body: "Sur toute connexion taguée « prod », les actions destructrices — suppression d'une ligne, modification ou suppression d'une colonne, requête d'écriture brute — sont bloquées tant que vous n'avez pas tapé le nom de la connexion. Le panneau de schéma est en lecture seule par défaut.",
          img: "/landing/prod-guard.png",
          alt: "Boîte de dialogue de confirmation du garde-fou production",
        },
        {
          eyebrow: "Palette de commandes",
          tone: "var(--dev)",
          title: "⌘K pour aller n'importe où",
          body: "Naviguez entre connexions et tables, changez de vue ou déclenchez une action sans toucher la souris. Pensé pour ceux qui vivent dans leur éditeur.",
          img: "/landing/command-palette.png",
          alt: "Palette de commandes",
        },
        {
          eyebrow: "Vue galerie",
          tone: "var(--local)",
          title: "Quatre vues, une seule table",
          body: "Les vues Table, Board, Calendrier et Galerie partagent les mêmes filtres, tris et regroupements — changez de perspective sans perdre votre position.",
          img: "/landing/gallery-view.png",
          alt: "Vue galerie",
        },
      ],
    },
    finalCta: {
      title: "Gratuit. Open-source. Auto-hébergé.",
      body: "Clonez-le, connectez-le à votre base, et ne confondez plus jamais d'environnement.",
      primary: "Star sur GitHub",
      secondary: "Ouvrir l'app →",
    },
    footer: { license: "Overlook contributors · Licence MIT", github: "GitHub", openApp: "Ouvrir l'app" },
    langSwitch: { label: "EN", href: "/landing" },
  },
};
