# Bot application ownership move

Step 19 of the repository split. Source algorithms, imported bindings and ordered code bodies are preserved; paths and import ordering change. Runtime outputs still use the assembled project root.

## File moves

| SHAG source | Washoi destination in the assembled checkout |
| --- | --- |
| `src/bot/BotAimController.ts` | `src/games/fps/bot/BotAimController.ts` |
| `src/bot/BotBrain.ts` | `src/games/fps/bot/BotBrain.ts` |
| `src/bot/BotClient.ts` | `src/games/fps/bot/BotClient.ts` |
| `src/bot/BotCombatMovement.ts` | `src/games/fps/bot/BotCombatMovement.ts` |
| `src/bot/BotConfig.ts` | `src/games/fps/bot/BotConfig.ts` |
| `src/bot/BotEpisodeRecorder.ts` | `src/games/fps/bot/BotEpisodeRecorder.ts` |
| `src/bot/BotFireSafety.ts` | `src/games/fps/bot/BotFireSafety.ts` |
| `src/bot/BotGameState.ts` | `src/games/fps/bot/BotGameState.ts` |
| `src/bot/BotInputNormalizer.ts` | `src/games/fps/bot/BotInputNormalizer.ts` |
| `src/bot/BotLobbyClient.ts` | `src/games/fps/bot/BotLobbyClient.ts` |
| `src/bot/BotMood.ts` | `src/games/fps/bot/BotMood.ts` |
| `src/bot/BotMovementAnalyzer.ts` | `src/games/fps/bot/BotMovementAnalyzer.ts` |
| `src/bot/BotMovementProfile.ts` | `src/games/fps/bot/BotMovementProfile.ts` |
| `src/bot/BotNavCache.ts` | `src/games/fps/bot/BotNavCache.ts` |
| `src/bot/BotNavGraph.ts` | `src/games/fps/bot/BotNavGraph.ts` |
| `src/bot/BotPerception.ts` | `src/games/fps/bot/BotPerception.ts` |
| `src/bot/BotRatingIdentity.ts` | `src/games/fps/bot/BotRatingIdentity.ts` |
| `src/bot/BotReactionTuning.ts` | `src/games/fps/bot/BotReactionTuning.ts` |
| `src/bot/BotRewardComputer.ts` | `src/games/fps/bot/BotRewardComputer.ts` |
| `src/bot/BotSequence.ts` | `src/games/fps/bot/BotSequence.ts` |
| `src/bot/BotServer.ts` | `src/games/fps/bot/BotServer.ts` |
| `src/bot/BotTerritory.ts` | `src/games/fps/bot/BotTerritory.ts` |
| `src/bot/BotTrainer.ts` | `src/games/fps/bot/BotTrainer.ts` |
| `src/bot/BotVision.ts` | `src/games/fps/bot/BotVision.ts` |
| `src/bot/BotWeaponCombos.ts` | `src/games/fps/bot/BotWeaponCombos.ts` |
| `src/bot/BotWeaponProfile.ts` | `src/games/fps/bot/BotWeaponProfile.ts` |
| `src/bot/CloningTargets.ts` | `src/games/fps/bot/CloningTargets.ts` |
| `src/bot/DemoTrainingExtractor.ts` | `src/games/fps/bot/DemoTrainingExtractor.ts` |
| `src/bot/DenseForward.ts` | `src/games/fps/bot/DenseForward.ts` |
| `src/bot/HybridBrain.ts` | `src/games/fps/bot/HybridBrain.ts` |
| `src/bot/LearnedRoutes.ts` | `src/games/fps/bot/LearnedRoutes.ts` |
| `src/bot/LedgeSlideJump.ts` | `src/games/fps/bot/LedgeSlideJump.ts` |
| `src/bot/ModelInputs.ts` | `src/games/fps/bot/ModelInputs.ts` |
| `src/bot/ModelMetadata.ts` | `src/games/fps/bot/ModelMetadata.ts` |
| `src/bot/RouteLearner.ts` | `src/games/fps/bot/RouteLearner.ts` |
| `src/bot/StateMachineBrain.ts` | `src/games/fps/bot/StateMachineBrain.ts` |
| `src/bot/TFBackend.ts` | `src/games/fps/bot/TFBackend.ts` |
| `src/bot/TrainingCorpus.ts` | `src/games/fps/bot/TrainingCorpus.ts` |
| `src/bot/TrainingReport.ts` | `src/games/fps/bot/TrainingReport.ts` |
| `src/bot/TypedLoss.ts` | `src/games/fps/bot/TypedLoss.ts` |
| `src/bot/__tests__/BotAimController.test.ts` | `src/games/fps/bot/__tests__/BotAimController.test.ts` |
| `src/bot/__tests__/BotChaseMovement.test.ts` | `src/games/fps/bot/__tests__/BotChaseMovement.test.ts` |
| `src/bot/__tests__/BotChat.test.ts` | `src/games/fps/bot/__tests__/BotChat.test.ts` |
| `src/bot/__tests__/BotCombatMovement.test.ts` | `src/games/fps/bot/__tests__/BotCombatMovement.test.ts` |
| `src/bot/__tests__/BotLiquidAwareness.test.ts` | `src/games/fps/bot/__tests__/BotLiquidAwareness.test.ts` |
| `src/bot/__tests__/BotLobbyReference.test.ts` | `src/games/fps/bot/__tests__/BotLobbyReference.test.ts` |
| `src/bot/__tests__/BotMood.test.ts` | `src/games/fps/bot/__tests__/BotMood.test.ts` |
| `src/bot/__tests__/BotMovementAnalyzer.test.ts` | `src/games/fps/bot/__tests__/BotMovementAnalyzer.test.ts` |
| `src/bot/__tests__/BotNavCache.test.ts` | `src/games/fps/bot/__tests__/BotNavCache.test.ts` |
| `src/bot/__tests__/BotNavGraph.test.ts` | `src/games/fps/bot/__tests__/BotNavGraph.test.ts` |
| `src/bot/__tests__/BotNavigationRecovery.test.ts` | `src/games/fps/bot/__tests__/BotNavigationRecovery.test.ts` |
| `src/bot/__tests__/BotPerception.test.ts` | `src/games/fps/bot/__tests__/BotPerception.test.ts` |
| `src/bot/__tests__/BotPerceptionSafety.test.ts` | `src/games/fps/bot/__tests__/BotPerceptionSafety.test.ts` |
| `src/bot/__tests__/BotRatingIdentity.test.ts` | `src/games/fps/bot/__tests__/BotRatingIdentity.test.ts` |
| `src/bot/__tests__/BotReactionTuning.test.ts` | `src/games/fps/bot/__tests__/BotReactionTuning.test.ts` |
| `src/bot/__tests__/BotSequence.test.ts` | `src/games/fps/bot/__tests__/BotSequence.test.ts` |
| `src/bot/__tests__/BotServerControlAuth.test.ts` | `src/games/fps/bot/__tests__/BotServerControlAuth.test.ts` |
| `src/bot/__tests__/BotServerModelDir.test.ts` | `src/games/fps/bot/__tests__/BotServerModelDir.test.ts` |
| `src/bot/__tests__/BotTeams.test.ts` | `src/games/fps/bot/__tests__/BotTeams.test.ts` |
| `src/bot/__tests__/BotTerritory.test.ts` | `src/games/fps/bot/__tests__/BotTerritory.test.ts` |
| `src/bot/__tests__/BotVisionSharedLos.test.ts` | `src/games/fps/bot/__tests__/BotVisionSharedLos.test.ts` |
| `src/bot/__tests__/BotWeaponCombos.test.ts` | `src/games/fps/bot/__tests__/BotWeaponCombos.test.ts` |
| `src/bot/__tests__/CloningTargets.test.ts` | `src/games/fps/bot/__tests__/CloningTargets.test.ts` |
| `src/bot/__tests__/Considerations.test.ts` | `src/games/fps/bot/__tests__/Considerations.test.ts` |
| `src/bot/__tests__/DemoPipelineEndToEnd.test.ts` | `src/games/fps/bot/__tests__/DemoPipelineEndToEnd.test.ts` |
| `src/bot/__tests__/DemoTrainingSelection.test.ts` | `src/games/fps/bot/__tests__/DemoTrainingSelection.test.ts` |
| `src/bot/__tests__/DemoTrainingSmoke.test.ts` | `src/games/fps/bot/__tests__/DemoTrainingSmoke.test.ts` |
| `src/bot/__tests__/DenseForward.test.ts` | `src/games/fps/bot/__tests__/DenseForward.test.ts` |
| `src/bot/__tests__/Directives.test.ts` | `src/games/fps/bot/__tests__/Directives.test.ts` |
| `src/bot/__tests__/FrameSpacing.test.ts` | `src/games/fps/bot/__tests__/FrameSpacing.test.ts` |
| `src/bot/__tests__/HybridBrainOutputs.test.ts` | `src/games/fps/bot/__tests__/HybridBrainOutputs.test.ts` |
| `src/bot/__tests__/ItemGoalPlanner.test.ts` | `src/games/fps/bot/__tests__/ItemGoalPlanner.test.ts` |
| `src/bot/__tests__/ItemGoalSource.test.ts` | `src/games/fps/bot/__tests__/ItemGoalSource.test.ts` |
| `src/bot/__tests__/ItemSlideApproachSequence.test.ts` | `src/games/fps/bot/__tests__/ItemSlideApproachSequence.test.ts` |
| `src/bot/__tests__/LedgeSlideJump.test.ts` | `src/games/fps/bot/__tests__/LedgeSlideJump.test.ts` |
| `src/bot/__tests__/ModelInputs.test.ts` | `src/games/fps/bot/__tests__/ModelInputs.test.ts` |
| `src/bot/__tests__/ModelMetadata.test.ts` | `src/games/fps/bot/__tests__/ModelMetadata.test.ts` |
| `src/bot/__tests__/NavTravelCost.test.ts` | `src/games/fps/bot/__tests__/NavTravelCost.test.ts` |
| `src/bot/__tests__/RouteCrouchslideSequence.test.ts` | `src/games/fps/bot/__tests__/RouteCrouchslideSequence.test.ts` |
| `src/bot/__tests__/RouteStrafeJumpSequence.test.ts` | `src/games/fps/bot/__tests__/RouteStrafeJumpSequence.test.ts` |
| `src/bot/__tests__/SlideBladeSequence.test.ts` | `src/games/fps/bot/__tests__/SlideBladeSequence.test.ts` |
| `src/bot/__tests__/StateMachineBrain.test.ts` | `src/games/fps/bot/__tests__/StateMachineBrain.test.ts` |
| `src/bot/__tests__/TrainInferenceParity.test.ts` | `src/games/fps/bot/__tests__/TrainInferenceParity.test.ts` |
| `src/bot/__tests__/TrainingCorpus.test.ts` | `src/games/fps/bot/__tests__/TrainingCorpus.test.ts` |
| `src/bot/__tests__/TrainingDataFlow.test.ts` | `src/games/fps/bot/__tests__/TrainingDataFlow.test.ts` |
| `src/bot/__tests__/TrainingReport.test.ts` | `src/games/fps/bot/__tests__/TrainingReport.test.ts` |
| `src/bot/__tests__/TriggerTraversalSequences.test.ts` | `src/games/fps/bot/__tests__/TriggerTraversalSequences.test.ts` |
| `src/bot/__tests__/TypedLoss.test.ts` | `src/games/fps/bot/__tests__/TypedLoss.test.ts` |
| `src/bot/__tests__/ValidatedJumpSequence.test.ts` | `src/games/fps/bot/__tests__/ValidatedJumpSequence.test.ts` |
| `src/bot/__tests__/WeightProfiles.test.ts` | `src/games/fps/bot/__tests__/WeightProfiles.test.ts` |
| `src/bot/__tests__/fixtures/scriptedDemo.ts` | `src/games/fps/bot/__tests__/fixtures/scriptedDemo.ts` |
| `src/bot/chat/BotChat.ts` | `src/games/fps/bot/chat/BotChat.ts` |
| `src/bot/chat/BotChatLines.ts` | `src/games/fps/bot/chat/BotChatLines.ts` |
| `src/bot/goals/BotGoal.ts` | `src/games/fps/bot/goals/BotGoal.ts` |
| `src/bot/goals/Consideration.ts` | `src/games/fps/bot/goals/Consideration.ts` |
| `src/bot/goals/DirectiveGoalSource.ts` | `src/games/fps/bot/goals/DirectiveGoalSource.ts` |
| `src/bot/goals/GoalArbiter.ts` | `src/games/fps/bot/goals/GoalArbiter.ts` |
| `src/bot/goals/ItemGoalPlanner.ts` | `src/games/fps/bot/goals/ItemGoalPlanner.ts` |
| `src/bot/goals/ItemGoalSource.ts` | `src/games/fps/bot/goals/ItemGoalSource.ts` |
| `src/bot/goals/considerations/Danger.ts` | `src/games/fps/bot/goals/considerations/Danger.ts` |
| `src/bot/goals/considerations/ItemDenial.ts` | `src/games/fps/bot/goals/considerations/ItemDenial.ts` |
| `src/bot/goals/considerations/ItemFacts.ts` | `src/games/fps/bot/goals/considerations/ItemFacts.ts` |
| `src/bot/goals/considerations/ItemValue.ts` | `src/games/fps/bot/goals/considerations/ItemValue.ts` |
| `src/bot/goals/considerations/ObjectivePush.ts` | `src/games/fps/bot/goals/considerations/ObjectivePush.ts` |
| `src/bot/goals/considerations/RouteCost.ts` | `src/games/fps/bot/goals/considerations/RouteCost.ts` |
| `src/bot/goals/considerations/TeamPlay.ts` | `src/games/fps/bot/goals/considerations/TeamPlay.ts` |
| `src/bot/sequences/ItemSlideApproachSequence.ts` | `src/games/fps/bot/sequences/ItemSlideApproachSequence.ts` |
| `src/bot/sequences/LearnedRouteSequence.ts` | `src/games/fps/bot/sequences/LearnedRouteSequence.ts` |
| `src/bot/sequences/LedgeSlideJumpSequence.ts` | `src/games/fps/bot/sequences/LedgeSlideJumpSequence.ts` |
| `src/bot/sequences/RouteCrouchslideSequence.ts` | `src/games/fps/bot/sequences/RouteCrouchslideSequence.ts` |
| `src/bot/sequences/RouteStrafeJumpSequence.ts` | `src/games/fps/bot/sequences/RouteStrafeJumpSequence.ts` |
| `src/bot/sequences/SlideBladeSequence.ts` | `src/games/fps/bot/sequences/SlideBladeSequence.ts` |
| `src/bot/sequences/TraverseJumppadSequence.ts` | `src/games/fps/bot/sequences/TraverseJumppadSequence.ts` |
| `src/bot/sequences/TraverseTeleporterSequence.ts` | `src/games/fps/bot/sequences/TraverseTeleporterSequence.ts` |
| `src/bot/sequences/ValidatedJumpSequence.ts` | `src/games/fps/bot/sequences/ValidatedJumpSequence.ts` |
| `src/cli/bot-server.ts` | `src/games/fps/cli/bot-server.ts` |
| `src/engine/__tests__/BotRewardComputer.test.ts` | `src/games/fps/bot/__tests__/BotRewardComputer.test.ts` |
| `src/engine/__tests__/BotInputNormalizer.test.ts` | `src/games/fps/bot/__tests__/BotInputNormalizer.test.ts` |
| `src/engine/__tests__/HybridBrain.test.ts` | `src/games/fps/bot/__tests__/HybridBrain.test.ts` |
| `src/lobby/integration/PrivateBotInvite.test.ts` | `src/games/fps/bot/__tests__/PrivateBotInvite.test.ts` |

## Callers with rebased imports

- `experiments/shagged/solamphi1/verify.ts`
- `src/cli/bot-analyze.ts`
- `src/cli/bot-bench.ts`
- `src/cli/bot-learn.ts`
- `src/cli/bot-train.ts`
- `src/cli/record-demo.ts`
- `src/cli/timedemo-fixture.ts`
- `src/games/fps/editor/server/FpsMapAnalysis.ts`

## Install and persistence audit

- `TFBackend.ts` retains native TensorFlow first and pure-JavaScript fallback, including the Node util compatibility shim. The nonliteral fallback package import is unchanged.
- `package.json` still declares TensorFlow and `scripts/postinstall.mjs` still supplies its Windows DLL fixup. These belong to the later assembled install/configuration cutover; this move does not claim SHAG installation independence.
- Bot nav cache remains `BOT_NAV_CACHE_DIR`, else `.cache/bots/maps`; learned routes remain `config/bot-routes`; model paths remain caller-supplied and cwd-relative as before.
- `BotRatingIdentity.ts` still finds the nearest ancestor `package.json` and fingerprints the assembled `src`, lockfile and learned routes. The moved game has no package.json, so source and bundled execution select the same assembled root. Source/path changes naturally change this conservative behavior fingerprint; no existing ratings or stored demo references are rewritten.
- Optional native TensorFlow install behavior, packaged deployment without source files, and future independent-checkout installation recipes remain outside this checkpoint.

See [the progress log](./ENGINE_GAME_SPLIT_PROGRESS.md) for commands, before/after runtime checks and limitations.
