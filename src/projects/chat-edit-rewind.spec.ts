/**
 * Editing a prompt must rewind the *project*, not just the transcript.
 *
 * Archiving chat rows alone left `project.questionnaire`, `stage` and
 * `locked` untouched, so a reload restored questions generated for the
 * wording the user had just rewritten — and a project left `locked` could be
 * rewound but never re-run.
 */
import { ProjectStage, StageStatus } from './entities/user-project.entity';

type Update = {
  $set: Record<string, unknown>;
  $unset: Record<string, string>;
};

describe('rewindProjectToConversation', () => {
  function captureUpdate(service: unknown): Promise<Update> {
    return new Promise((resolve) => {
      (
        service as { userProjectModel: { updateOne: unknown } }
      ).userProjectModel = {
        updateOne: (_filter: unknown, update: Update) => {
          resolve(update);
          return { exec: () => Promise.resolve({}) };
        },
      };
    });
  }

  it('clears the saved questionnaire and unlocks the project', async () => {
    const service = Object.create(
      // rewindProjectToConversation moved to ChatsService when ProjectsService
      // was decomposed; the behavior contract is unchanged.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./chats.service').ChatsService.prototype,
    ) as { rewindProjectToConversation: (id: string) => Promise<void> };

    const pending = captureUpdate(service);
    await service.rewindProjectToConversation('507f1f77bcf86cd799439011');
    const update = await pending;

    expect(update.$unset).toHaveProperty('questionnaire');
    expect(update.$set).toMatchObject({
      stage: ProjectStage.CONVERSATION,
      stageStatus: StageStatus.IN_PROGRESS,
      completedStages: [],
      locked: false,
    });
  });
});
