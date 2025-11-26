//! Pipeline Runner: Encadeia estágios com validação e coleta de métricas
use crate::stage::Stage;
use crate::data_model::{CompiledArtifact, Proof, StageProof, QualityProof};
use crate::context::ExecutionContext;
use blake3;
use std::time::Instant;

pub struct PipelineRunner {
    stages: Vec<Box<dyn Stage>>,
    pipeline_id: String,
}

impl PipelineRunner {
    pub fn new(stages: Vec<Box<dyn Stage>>) -> Self {
        let pipeline_id = stages
            .iter()
            .map(|s| s.id().split('.').next().unwrap_or("?"))
            .collect::<Vec<_>>()
            .join("→");

        Self { stages, pipeline_id }
    }

    pub async fn run(
        &self,
        input: &[u8],
        ctx: &ExecutionContext,
    ) -> Result<(Vec<u8>, Vec<StageProof>), crate::error::TdlnError> {
        let mut current = input.to_vec();
        let mut proofs = Vec::new();

        for stage in &self.stages {
            let start = Instant::now();
            let in_hash = self.hash_bytes(&current);

            let result = stage.run(&current, ctx).map_err(|e| {
                crate::error::TdlnError::ParseError(e.to_string())
            })?;

            let out_hash = self.hash_bytes(&result);
            let latency_ms = start.elapsed().as_millis() as u64;

            proofs.push(StageProof {
                id: stage.id().to_string(),
                in_hash,
                out_hash,
                deterministic: stage.deterministic(),
                latency_ms,
                verdict: None,
            });

            current = result;
        }

        Ok((current, proofs))
    }

    fn hash_bytes(&self, data: &[u8]) -> String {
        format!("blake3:{}", blake3::hash(data))
    }

    pub fn pipeline_id(&self) -> &str {
        &self.pipeline_id
    }
}