export interface IVercelService {
  createDeployment(
    projectId: string,
    files: Record<string, string>,
    framework?: string,
  ): Promise<VercelDeployment>;

  getDeploymentStatus(deploymentId: string): Promise<VercelDeploymentStatus>;

  assignAlias(deploymentId: string, alias: string): Promise<string>;

  deleteDeployment(deploymentId: string): Promise<boolean>;

  removeAlias(alias: string): Promise<boolean>;

  /**
   * Fetch build log lines for a deployment. Returns stdout + stderr
   * concatenated as a single string, suitable for error parsing.
   * @param tailKb max kilobytes to return from the end of the log (default 32)
   */
  getDeploymentLogs(deploymentId: string, tailKb?: number): Promise<string>;
}

export interface VercelDeployment {
  id: string;
  url: string;
  readyState: string;
  createdAt: number;
}

export interface VercelDeploymentStatus {
  id: string;
  readyState: 'QUEUED' | 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED';
  url: string;
  alias?: string[];
  error?:
    | string
    | {
        code?: string;
        message?: string;
        [key: string]: any; // Allow additional error properties
      };
}

export interface VercelFile {
  file: string;
  data: string;
  encoding?: 'base64' | 'utf-8';
}

export interface VercelDomainResponse {
  name: string;
  apexName?: string;
  projectId?: string;
  redirect?: string | null;
  redirectStatusCode?: number | null;
  gitBranch?: string | null;
  customEnvironmentId?: string | null;
  updatedAt?: number;
  createdAt?: number;
  verified: boolean;
  verification?: Array<{
    type: string;
    domain: string;
    value: string;
    reason: string;
  }>;
}

export interface VercelDomainConfig {
  configuredBy?: 'CNAME' | 'A' | 'http' | null;
  acceptedChallenges?: Array<'dns-01' | 'http-01'>;
  misconfigured: boolean;
}
