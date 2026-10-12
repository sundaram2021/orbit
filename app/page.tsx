import { HeroSection } from "@/components/home/hero-section";
import { WorkflowSection } from "@/components/home/workflow-section";
import { BentoSection } from "@/components/home/bento-section";
import { StepsSection } from "@/components/home/steps-section";
import { FooterStage } from "@/components/home/footer-stage";

export const metadata = {
  title: "Orbit — Your autonomous software factory",
  description:
    "From GitHub issue to pull request. Orbit orchestrates specialized agents that build, review, and learn together.",
};

export default async function HomePage() {
  return (
    <main className="stages-container">
      <HeroSection />
      <WorkflowSection />
      <BentoSection />
      <StepsSection />
      <FooterStage />
    </main>
  );
}
