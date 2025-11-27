"use client";

import { useState } from "react";
import JobViewer from "../../components/JobViewer";
import JobsList from "../../components/JobsList";
import CreateJobForm from "../../components/CreateJobForm";

export default function JobsPage() {
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 24 }}>
      <div>
        <CreateJobForm onCreated={setSelectedId} />
        <div style={{ marginTop: 24 }}>
          <JobsList onSelect={setSelectedId} />
        </div>
      </div>
      <div>
        <JobViewer jobId={selectedId} />
      </div>
    </div>
  );
}
