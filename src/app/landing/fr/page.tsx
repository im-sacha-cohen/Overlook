import type { Metadata } from "next";
import { LandingContent } from "../LandingContent";
import { LANDING_COPY } from "../copy";

export const metadata: Metadata = {
  title: LANDING_COPY.fr.metaTitle,
  description: LANDING_COPY.fr.metaDescription,
};

export default function LandingPageFr() {
  return <LandingContent lang="fr" />;
}
