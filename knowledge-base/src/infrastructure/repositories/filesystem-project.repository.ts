import { Injectable } from '@nestjs/common';

import { readEnvironment } from '../../adapters/environment.js';
import { loadProjects, type Project } from '../../domain/projects.js';
import { loadWorkspaces, type Workspace } from '../../domain/workspaces.js';
import { ProjectRepository, WorkspaceRepository } from '../../application/ports/repositories.js';

@Injectable()
export class FilesystemProjectRepository extends ProjectRepository {
  async list(): Promise<Project[]> {
    const environment = readEnvironment();
    return loadProjects(environment.manifestPath);
  }
}

@Injectable()
export class FilesystemWorkspaceRepository extends WorkspaceRepository {
  async list(): Promise<Workspace[]> {
    const environment = readEnvironment();
    const workspaces = await loadWorkspaces(environment.workspacesManifestPath);
    if (workspaces.length) return workspaces;

    const projects = await loadProjects(environment.manifestPath);
    return [
      {
        workspaceSlug: 'default',
        displayName: 'Default Workspace',
        whatsappGroupJid: '',
        telegramChatId: '',
        githubRepos: Array.from(new Set(projects.map((project) => project.repoFullName).filter(Boolean))),
        projectSlugs: projects.map((project) => project.projectSlug),
        createdAt: '',
        updatedAt: '',
      },
    ];
  }
}
