import JobViewer from "../../../components/JobViewer";

export default function JobDetail({ params }: { params: { id: string } }) {
  return (
    <div>
      <h2>Job {params.id}</h2>
      <JobViewer jobId={params.id} />
    </div>
  );
}
