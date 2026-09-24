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
    img: string;
    imgAlt: string;
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
      img: "/landing/table-view.png",
      imgAlt: "Overlook table view on a production connection",
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
        { icon: "◈", tone: "var(--dev)", title: "Every connection, clearly labeled", body: "PostgreSQL, MySQL, and SQLite side by side, each tagged Local, Dev, Staging, Prod, or Custom and filed into folders. Connect through SSH tunnels, with verified TLS certificates." },
        { icon: "▲", tone: "var(--prod)", title: "Production guardrails", body: "On prod, deleting rows, changing the schema, or running a write query means typing the connection's name. Bulk and schema changes show the exact SQL and the rows affected first." },
        { icon: "⧩", tone: "var(--staging)", title: "Filters that follow foreign keys", body: "Filter on several values, match all or any condition, group conditions, and filter on columns of related tables. Suggested values show how many rows each one keeps." },
        { icon: "⇆", tone: "var(--dev)", title: "Compare and map", body: "Diff the schemas and rows of two connections, say staging and prod, and draw a relations diagram of every table." },
        { icon: "➜", tone: "var(--local)", title: "Send data across connections", body: "Copy selected rows or whole tables to another connection, such as a slice of prod into your local database." },
        { icon: "↺", tone: "var(--dev)", title: "Change log with undo", body: "Every write is recorded in a persistent log you can browse and filter. Made a mistake on a non-prod table? Undo it in one click." },
        { icon: "›_", tone: "var(--staging)", title: "SQL console", body: "Saved queries and a query history. The read-only mode is enforced by the database itself, not just by the UI." },
        { icon: "⇄", tone: "var(--local)", title: "Import & export", body: "CSV import, and big SQL scripts run in batched transactions with live progress. Export to SQL, CSV, or NDJSON." },
        { icon: "⌘", tone: "var(--prod)", title: "Fast, keyboard-first", body: "Table, Board, Calendar, and Gallery views, saved views and shareable links, ⌘K and shortcuts, and copy-paste of cell ranges." },
      ],
    },
    showcase: {
      rows: [
        {
          eyebrow: "Production guardrail",
          tone: "var(--prod)",
          title: "Confirm by typing the connection's name",
          body: "On a connection tagged \"prod,\" deleting rows, altering the schema, or running a raw write query stays blocked until you type the connection's name, with the exact SQL in front of you.",
          img: "/landing/prod-guard.png",
          alt: "Production guardrail confirmation dialog",
        },
        {
          eyebrow: "Filters",
          tone: "var(--staging)",
          title: "Filter through relations",
          body: "Keep the orders whose customer is on the Enterprise plan without writing a join. Every suggested value shows how many rows it would keep, and the whole view can be shared as a link.",
          img: "/landing/filters.png",
          alt: "Filters on a related table with value suggestions",
        },
        {
          eyebrow: "Compare",
          tone: "var(--dev)",
          title: "See what differs between two databases",
          body: "Pick two connections to list the tables and columns found on one side only or defined differently, then compare a table's rows.",
          img: "/landing/compare.png",
          alt: "Schema comparison between staging and production",
        },
        {
          eyebrow: "Relations diagram",
          tone: "var(--local)",
          title: "Your schema at a glance",
          body: "Every table with its columns and foreign keys, laid out automatically. Drag, zoom, and double-click a table to open it.",
          img: "/landing/diagram.png",
          alt: "Relations diagram of the database",
        },
        {
          eyebrow: "Command palette",
          tone: "var(--dev)",
          title: "⌘K to go anywhere",
          body: "Jump to a table, switch view, or run a command without touching the mouse. Built for people who live in their editor.",
          img: "/landing/command-palette.png",
          alt: "Command palette",
        },
      ],
    },
    finalCta: {
      title: "Free. Open-source. Self-hosted.",
      body: "Run it on your own machine, point it at your databases, and never mix up an environment again. It listens on localhost by default and is hardened against DNS rebinding and CSRF.",
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
      img: "/landing/fr/table-view.png",
      imgAlt: "Vue table d'Overlook sur une connexion de production",
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
        { icon: "◈", tone: "var(--dev)", title: "Chaque connexion bien identifiée", body: "PostgreSQL, MySQL et SQLite côte à côte, chacune taguée Local, Dev, Staging, Prod ou Custom et rangée dans des dossiers. Connexion via tunnel SSH, avec vérification des certificats TLS." },
        { icon: "▲", tone: "var(--prod)", title: "Garde-fous production", body: "En prod, supprimer des lignes, modifier le schéma ou lancer une requête d'écriture exige de taper le nom de la connexion. Les modifications en masse et de schéma montrent d'abord le SQL exact et les lignes touchées." },
        { icon: "⧩", tone: "var(--staging)", title: "Des filtres qui suivent les clés étrangères", body: "Filtrez sur plusieurs valeurs, toutes ou au moins une condition, par groupes, et sur les colonnes des tables liées. Les valeurs suggérées indiquent combien de lignes chacune garde." },
        { icon: "⇆", tone: "var(--dev)", title: "Comparer et cartographier", body: "Comparez le schéma et les lignes de deux connexions, par exemple staging et prod, et affichez le diagramme des relations entre toutes les tables." },
        { icon: "➜", tone: "var(--local)", title: "Envoyer des données d'une base à l'autre", body: "Copiez des lignes sélectionnées ou des tables entières vers une autre connexion, par exemple un extrait de la prod vers votre base locale." },
        { icon: "↺", tone: "var(--dev)", title: "Journal avec annulation", body: "Chaque écriture est consignée dans un journal persistant, consultable et filtrable. Une erreur sur une table hors prod ? Annulez-la en un clic." },
        { icon: "›_", tone: "var(--staging)", title: "Console SQL", body: "Requêtes enregistrées et historique. Le mode lecture seule est imposé par la base elle-même, pas seulement par l'interface." },
        { icon: "⇄", tone: "var(--local)", title: "Import & export", body: "Import CSV, et gros scripts SQL exécutés par lots dans des transactions, avec la progression en direct. Export en SQL, CSV ou NDJSON." },
        { icon: "⌘", tone: "var(--prod)", title: "Rapide, pensé pour le clavier", body: "Vues Table, Board, Calendrier et Galerie, vues enregistrées et liens partageables, ⌘K et raccourcis, copier-coller de plages de cellules." },
      ],
    },
    showcase: {
      rows: [
        {
          eyebrow: "Garde-fou production",
          tone: "var(--prod)",
          title: "Confirmation en tapant le nom de la connexion",
          body: "Sur une connexion taguée « prod », supprimer des lignes, modifier le schéma ou lancer une requête d'écriture brute reste bloqué tant que vous n'avez pas tapé le nom de la connexion, avec le SQL exact sous les yeux.",
          img: "/landing/fr/prod-guard.png",
          alt: "Boîte de dialogue de confirmation du garde-fou production",
        },
        {
          eyebrow: "Filtres",
          tone: "var(--staging)",
          title: "Filtrer à travers les relations",
          body: "Gardez les commandes dont le client est sur l'offre Enterprise, sans écrire de jointure. Chaque valeur suggérée indique combien de lignes elle garderait, et la vue entière se partage par lien.",
          img: "/landing/fr/filters.png",
          alt: "Filtres sur une table liée avec suggestions de valeurs",
        },
        {
          eyebrow: "Comparaison",
          tone: "var(--dev)",
          title: "Voir ce qui diffère entre deux bases",
          body: "Choisissez deux connexions pour lister les tables et colonnes présentes d'un seul côté ou définies différemment, puis comparez les lignes d'une table.",
          img: "/landing/fr/compare.png",
          alt: "Comparaison des schémas entre staging et production",
        },
        {
          eyebrow: "Diagramme des relations",
          tone: "var(--local)",
          title: "Votre schéma d'un coup d'œil",
          body: "Toutes les tables avec leurs colonnes et leurs clés étrangères, disposées automatiquement. Déplacez, zoomez, double-cliquez sur une table pour l'ouvrir.",
          img: "/landing/fr/diagram.png",
          alt: "Diagramme des relations de la base",
        },
        {
          eyebrow: "Palette de commandes",
          tone: "var(--dev)",
          title: "⌘K pour aller n'importe où",
          body: "Ouvrez une table, changez de vue ou lancez une commande sans toucher la souris. Pensé pour ceux qui vivent dans leur éditeur.",
          img: "/landing/fr/command-palette.png",
          alt: "Palette de commandes",
        },
      ],
    },
    finalCta: {
      title: "Gratuit. Open-source. Auto-hébergé.",
      body: "Lancez-le sur votre machine, connectez-le à vos bases, et ne confondez plus jamais d'environnement. Il n'écoute qu'en local par défaut et se protège contre le DNS rebinding et le CSRF.",
      primary: "Star sur GitHub",
      secondary: "Ouvrir l'app →",
    },
    footer: { license: "Overlook contributors · Licence MIT", github: "GitHub", openApp: "Ouvrir l'app" },
    langSwitch: { label: "EN", href: "/landing" },
  },
};
