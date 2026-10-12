import { HeroSection } from "@/components/home/hero-section";
import { WorkflowSection } from "@/components/home/workflow-section";
import { IntegrationStrip } from "@/components/home/integration-strip";
import { BentoSection } from "@/components/home/bento-section";
import { StepsSection } from "@/components/home/steps-section";
import { FooterCta } from "@/components/home/footer-cta";
import { SiteFooter } from "@/components/home/site-footer";

export const metadata = {
  title: "Orbit — Your autonomous software factory",
  description:
    "From GitHub issue to pull request. Orbit orchestrates specialized agents that build, review, and learn together.",
};

export default async function HomePage() {
  return (
    <main>
      <HeroSection />
      <WorkflowSection />
      <IntegrationStrip />
      <BentoSection />
      <StepsSection />
      <FooterCta />
      <SiteFooter />
    </main>
  );
}
