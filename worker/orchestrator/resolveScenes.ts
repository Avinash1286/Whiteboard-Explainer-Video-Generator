import type {
  SceneResolverInput,
  SceneResolverOutput,
  SceneWorkItem,
} from "./types";

function createSceneWorkItems(input: SceneResolverInput): SceneWorkItem[] {
  return input.videoPlan.scenes.map((scene, index) => ({
    sceneIndex: index,
    totalScenes: input.videoPlan.scenes.length,
    plan: scene,
  }));
}

export async function resolveScenesInParallel(
  input: SceneResolverInput,
): Promise<SceneResolverOutput> {
  const workItems = createSceneWorkItems(input);
  const scenes = await Promise.all(
    workItems.map(async (item) => {
      await input.onProgress?.({
        sceneId: item.plan.id,
        sceneIndex: item.sceneIndex,
        totalScenes: item.totalScenes,
        status: "started",
        message: `Resolving scene ${item.sceneIndex + 1} of ${item.totalScenes}`,
      });

      const resolved = input.compiled.timeline.scenes.find((scene) => scene.id === item.plan.id);
      if (!resolved) {
        throw new Error(`Resolved timeline is missing scene ${item.plan.id}`);
      }

      await input.onProgress?.({
        sceneId: item.plan.id,
        sceneIndex: item.sceneIndex,
        totalScenes: item.totalScenes,
        status: "completed",
        message: `Resolved scene ${item.sceneIndex + 1} of ${item.totalScenes}`,
      });

      return resolved;
    }),
  );

  return { scenes };
}
