import { useNavigate } from "react-router-dom";
import { CreateWorkItemWizard } from "../components/workbench/import/CreateWorkItemWizard.jsx";
import { WorkbenchHeader } from "../components/workbench/ui/WorkbenchPrimitives.jsx";

export default function NewItem() {
  const navigate = useNavigate();
  return (
    <main className="mbw-page">
      <WorkbenchHeader
        eyebrow="Stark Hub"
        title="Novo item"
        subtitle="Crie Epic, Feature, User Story, Bug, Task ou Test Case via Azure API, com previa e notificacao Slack."
      />
      <CreateWorkItemWizard embedded onClose={() => navigate(-1)} />
    </main>
  );
}
