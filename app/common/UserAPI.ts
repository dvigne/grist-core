import {ApplyUAResult} from 'app/common/ActiveDocAPI';
import {BaseAPI, IOptions} from 'app/common/BaseAPI';
import {BillingAPI, BillingAPIImpl} from 'app/common/BillingAPI';
import {BrowserSettings} from 'app/common/BrowserSettings';
import {BulkColValues, TableColValues, UserAction} from 'app/common/DocActions';
import {DocCreationInfo} from 'app/common/DocListAPI';
import {Features} from 'app/common/Features';
import {isClient} from 'app/common/gristUrls';
import {FullUser} from 'app/common/LoginSessionAPI';
import * as roles from 'app/common/roles';
import {addCurrentOrgToPath} from 'app/common/urlUtils';

// Nominal email address of the anonymous user.
export const ANONYMOUS_USER_EMAIL = 'anon@getgrist.com';

// A special user allowed to add/remove the EVERYONE_EMAIL to/from a resource.
export const SUPPORT_EMAIL = 'support@getgrist.com';

// A special 'docId' that means to create a new document.
export const NEW_DOCUMENT_CODE = 'new';

// Properties shared by org, workspace, and doc resources.
export interface CommonProperties {
  name: string;
  createdAt: string;  // ISO date string
  updatedAt: string;  // ISO date string
  removedAt?: string; // ISO date string - only can appear on docs and workspaces currently
  public?: boolean;   // If set, resource is available to the public
}
export const commonPropertyKeys = ['createdAt', 'name', 'updatedAt'];

export interface OrganizationProperties extends CommonProperties {
  domain: string|null;
}
export const organizationPropertyKeys = [...commonPropertyKeys, 'domain'];

// Basic information about an organization, excluding the user's access level
export interface OrganizationWithoutAccessInfo extends OrganizationProperties {
  id: number;
  owner: FullUser|null;
  billingAccount?: BillingAccount;
  host: string|null;  // if set, org's preferred domain (e.g. www.thing.com)
}

// Organization information plus the user's access level
export interface Organization extends OrganizationWithoutAccessInfo {
  access: roles.Role;
}

// Basic information about a billing account associated with an org or orgs.
export interface BillingAccount {
  id: number;
  individual: boolean;
  product: Product;
  isManager: boolean;
}

// Information about the product associated with an org or orgs.
export interface Product {
  name: string;
  features: Features;
}

// The upload types vary based on which fetch implementation is in use.  This is
// an incomplete list.  For example, node streaming types are supported by node-fetch.
export type UploadType = string | Blob | Buffer;

/**
 * Returns a user-friendly org name, which is either org.name, or "@User Name" for personal orgs.
 */
export function getOrgName(org: Organization): string {
  return org.owner ? `@` + org.owner.name : org.name;
}

export type WorkspaceProperties = CommonProperties;
export const workspacePropertyKeys = ['createdAt', 'name', 'updatedAt'];

export interface Workspace extends WorkspaceProperties {
  id: number;
  docs: Document[];
  org: Organization;
  access: roles.Role;
  owner?: FullUser;  // Set when workspaces are in the "docs" pseudo-organization,
                     // assembled from multiple personal organizations.
                     // Not set when workspaces are all from the same organization.

  // Set when the workspace belongs to support@getgrist.com. We expect only one such workspace
  // ("Examples & Templates"), containing sample documents.
  isSupportWorkspace?: boolean;
}

export interface DocumentProperties extends CommonProperties {
  isPinned: boolean;
  urlId: string|null;
}
export const documentPropertyKeys = [...commonPropertyKeys, 'isPinned', 'urlId'];

export interface Document extends DocumentProperties {
  id: string;
  workspace: Workspace;
  access: roles.Role;
}

export interface PermissionDelta {
  maxInheritedRole?: roles.BasicRole|null;
  users?: {
    // Maps from email to group name, or null to inherit.
    [email: string]: roles.NonGuestRole|null
  };
}

export interface PermissionData {
  maxInheritedRole?: roles.BasicRole|null;
  users: UserAccessData[];
}

// A structure for modifying managers of a billing account.
export interface ManagerDelta {
  users: {
    // To add a manager, link their email to 'managers'.
    // To remove a manager, link their email to null.
    // This format is used to rhyme with the ACL PermissionDelta format.
    [email: string]: 'managers'|null
  };
}

// Information about a user and their access to an unspecified resource of interest.
export interface UserAccessData {
  id: number;
  name: string;
  email: string;
  picture?: string|null; // When present, a url to a public image of unspecified dimensions.
  // Represents the user's direct access to the resource of interest. Lack of access to a resource
  // is represented by a null value.
  access: roles.Role|null;
  // A user's parentAccess represent their effective inheritable access to the direct parent of the resource
  // of interest. The user's effective access to the resource of interest can be determined based
  // on the user's parentAccess, the maxInheritedRole setting of the resource and the user's direct
  // access to the resource. Lack of access to the parent resource is represented by a null value.
  // If parent has non-inheritable access, this should be null.
  parentAccess?: roles.BasicRole|null;
}

export interface ActiveSessionInfo {
  user: FullUser & {helpScoutSignature?: string};
  org: Organization|null;
  orgError?: OrgError;
}

export interface OrgError {
  error: string;
  status: number;
}

/**
 * Options to control the source of a document being replaced.  For
 * example, a document could be initialized from another document
 * (e.g. a fork) or from a snapshot.
 */
export interface DocReplacementOptions {
  sourceDocId?: string;       // docId to copy from
  snapshotId?: string;        // s3 VersionId
}

/**
 * Information about a single document snapshot/backup.
 */
export interface DocSnapshot {
  lastModified: string;  // when the snapshot was made
  snapshotId: string;    // the id of the snapshot in the underlying store
  docId: string;         // an id for accessing the snapshot as a Grist document
}

/**
 * A list of document snapshots.
 */
export interface DocSnapshots {
  snapshots: DocSnapshot[];  // snapshots, freshest first.
}

/**
 * Information about a single document state.
 */
export interface DocState {
  n: number;  // a sequential identifier
  h: string;  // a hash identifier
}

/**
 * A list of document states.  Most recent is first.
 */
export interface DocStates {
  states: DocState[];
}

/**
 * A comparison between two documents, called "left" and "right".
 * The comparison is based on the action histories in the documents.
 * If those histories have been truncated, the comparison may report
 * two documents as being unrelated even if they do in fact have some
 * shared history.
 */
export interface DocStateComparison {
  left: DocState;         // left / local document
  right: DocState;        // right / remote document
  parent: DocState|null;  // most recent common ancestor of left and right
  // summary of the relationship between the two documents.
  //        same: documents have the same most recent state
  //        left: the left document has actions not yet in the right
  //       right: the right document has actions not yet in the left
  //        both: both documents have changes (possible divergence)
  //   unrelated: no common history found
  summary: 'same' | 'left' | 'right' | 'both' | 'unrelated';
}

export {UserProfile} from 'app/common/LoginSessionAPI';

export interface UserAPI {
  getSessionActive(): Promise<ActiveSessionInfo>;
  setSessionActive(email: string): Promise<void>;
  getSessionAll(): Promise<{users: FullUser[], orgs: Organization[]}>;
  getOrgs(merged?: boolean): Promise<Organization[]>;
  getWorkspace(workspaceId: number): Promise<Workspace>;
  getOrg(orgId: number|string): Promise<Organization>;
  getOrgWorkspaces(orgId: number|string): Promise<Workspace[]>;
  getDoc(docId: string): Promise<Document>;
  newOrg(props: Partial<OrganizationProperties>): Promise<number>;
  newWorkspace(props: Partial<WorkspaceProperties>, orgId: number|string): Promise<number>;
  newDoc(props: Partial<DocumentProperties>, workspaceId: number): Promise<string>;
  newUnsavedDoc(options?: {timezone?: string}): Promise<string>;
  renameOrg(orgId: number|string, name: string): Promise<void>;
  renameWorkspace(workspaceId: number, name: string): Promise<void>;
  renameDoc(docId: string, name: string): Promise<void>;
  updateDoc(docId: string, props: Partial<DocumentProperties>): Promise<void>;
  deleteOrg(orgId: number|string): Promise<void>;
  deleteWorkspace(workspaceId: number): Promise<void>;     // delete workspace permanently
  softDeleteWorkspace(workspaceId: number): Promise<void>; // soft-delete workspace
  undeleteWorkspace(workspaceId: number): Promise<void>;   // recover soft-deleted workspace
  deleteDoc(docId: string): Promise<void>;      // delete doc permanently
  softDeleteDoc(docId: string): Promise<void>;  // soft-delete doc
  undeleteDoc(docId: string): Promise<void>;    // recover soft-deleted doc
  updateOrgPermissions(orgId: number|string, delta: PermissionDelta): Promise<void>;
  updateWorkspacePermissions(workspaceId: number, delta: PermissionDelta): Promise<void>;
  updateDocPermissions(docId: string, delta: PermissionDelta): Promise<void>;
  getOrgAccess(orgId: number|string): Promise<PermissionData>;
  getWorkspaceAccess(workspaceId: number): Promise<PermissionData>;
  getDocAccess(docId: string): Promise<PermissionData>;
  pinDoc(docId: string): Promise<void>;
  unpinDoc(docId: string): Promise<void>;
  moveDoc(docId: string, workspaceId: number): Promise<void>;
  getUserProfile(): Promise<FullUser>;
  updateUserName(name: string): Promise<void>;
  getWorker(key: string): Promise<string>;
  getWorkerAPI(key: string): Promise<DocWorkerAPI>;
  getBillingAPI(): BillingAPI;
  getDocAPI(docId: string): DocAPI;
  fetchApiKey(): Promise<string>;
  createApiKey(): Promise<string>;
  deleteApiKey(): Promise<void>;
  getTable(docId: string, tableName: string): Promise<TableColValues>;
  applyUserActions(docId: string, actions: UserAction[]): Promise<ApplyUAResult>;
  importUnsavedDoc(material: UploadType, options?: {
    filename?: string,
    timezone?: string,
    onUploadProgress?: (ev: ProgressEvent) => void,
  }): Promise<string>;
  deleteUser(userId: number, name: string): Promise<void>;
  getBaseUrl(): string;  // Get the prefix for all the endpoints this object wraps.
  forRemoved(): UserAPI; // Get a version of the API that works on removed resources.
}

/**
 * Collect endpoints related to the content of a single document that we've been thinking
 * of as the (restful) "Doc API".  A few endpoints that could be here are not, for historical
 * reasons, such as downloads.
 */
export interface DocAPI {
  getRows(tableId: string): Promise<TableColValues>;
  updateRows(tableId: string, changes: TableColValues): Promise<number[]>;
  addRows(tableId: string, additions: BulkColValues): Promise<number[]>;
  replace(source: DocReplacementOptions): Promise<void>;
  getSnapshots(): Promise<DocSnapshots>;
  forceReload(): Promise<void>;
  compareState(remoteDocId: string): Promise<DocStateComparison>;
}

// Operations that are supported by a doc worker.
export interface DocWorkerAPI {
  readonly url: string;
  importDocToWorkspace(uploadId: number, workspaceId: number, settings?: BrowserSettings): Promise<DocCreationInfo>;
  upload(material: UploadType, filename?: string): Promise<number>;
  downloadDoc(docId: string, template?: boolean): Promise<Response>;
  copyDoc(docId: string, template?: boolean, name?: string): Promise<number>;
}

export class UserAPIImpl extends BaseAPI implements UserAPI {
  constructor(private _homeUrl: string, private _options: IOptions = {}) {
    super(_options);
  }

  public forRemoved(): UserAPI {
    const extraParameters = new Map<string, string>([['showRemoved', '1']]);
    return new UserAPIImpl(this._homeUrl, {...this._options, extraParameters});
  }

  public async getSessionActive(): Promise<ActiveSessionInfo> {
    return this.requestJson(`${this._url}/api/session/access/active`, {method: 'GET'});
  }

  public async setSessionActive(email: string): Promise<void> {
    const body = JSON.stringify({ email });
    return this.requestJson(`${this._url}/api/session/access/active`, {method: 'POST', body});
  }

  public async getSessionAll(): Promise<{users: FullUser[], orgs: Organization[]}> {
    return this.requestJson(`${this._url}/api/session/access/all`, {method: 'GET'});
  }

  public async getOrgs(merged: boolean = false): Promise<Organization[]> {
    return this.requestJson(`${this._url}/api/orgs?merged=${merged ? 1 : 0}`, { method: 'GET' });
  }

  public async getWorkspace(workspaceId: number): Promise<Workspace> {
    return this.requestJson(`${this._url}/api/workspaces/${workspaceId}`, { method: 'GET' });
  }

  public async getOrg(orgId: number|string): Promise<Organization> {
    return this.requestJson(`${this._url}/api/orgs/${orgId}`, { method: 'GET' });
  }

  public async getOrgWorkspaces(orgId: number|string): Promise<Workspace[]> {
    return this.requestJson(`${this._url}/api/orgs/${orgId}/workspaces?includeSupport=1`,
      { method: 'GET' });
  }

  public async getDoc(docId: string): Promise<Document> {
    return this.requestJson(`${this._url}/api/docs/${docId}`, { method: 'GET' });
  }

  public async newOrg(props: Partial<OrganizationProperties>): Promise<number> {
    return this.requestJson(`${this._url}/api/orgs`, {
      method: 'POST',
      body: JSON.stringify(props)
    });
  }

  public async newWorkspace(props: Partial<WorkspaceProperties>, orgId: number|string): Promise<number> {
    return this.requestJson(`${this._url}/api/orgs/${orgId}/workspaces`, {
      method: 'POST',
      body: JSON.stringify(props)
    });
  }

  public async newDoc(props: Partial<DocumentProperties>, workspaceId: number): Promise<string> {
    return this.requestJson(`${this._url}/api/workspaces/${workspaceId}/docs`, {
      method: 'POST',
      body: JSON.stringify(props)
    });
  }

  public async newUnsavedDoc(options: {timezone?: string} = {}): Promise<string> {
    return this.requestJson(`${this._url}/api/docs`, {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  public async renameOrg(orgId: number|string, name: string): Promise<void> {
    await this.request(`${this._url}/api/orgs/${orgId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name })
    });
  }

  public async renameWorkspace(workspaceId: number, name: string): Promise<void> {
    await this.request(`${this._url}/api/workspaces/${workspaceId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name })
    });
  }

  public async renameDoc(docId: string, name: string): Promise<void> {
    return this.updateDoc(docId, {name});
  }

  public async updateDoc(docId: string, props: Partial<DocumentProperties>): Promise<void> {
    await this.request(`${this._url}/api/docs/${docId}`, {
      method: 'PATCH',
      body: JSON.stringify(props)
    });
  }

  public async deleteOrg(orgId: number|string): Promise<void> {
    await this.request(`${this._url}/api/orgs/${orgId}`, { method: 'DELETE' });
  }

  public async deleteWorkspace(workspaceId: number): Promise<void> {
    await this.request(`${this._url}/api/workspaces/${workspaceId}`, { method: 'DELETE' });
  }

  public async softDeleteWorkspace(workspaceId: number): Promise<void> {
    await this.request(`${this._url}/api/workspaces/${workspaceId}/remove`, { method: 'POST' });
  }

  public async undeleteWorkspace(workspaceId: number): Promise<void> {
    await this.request(`${this._url}/api/workspaces/${workspaceId}/unremove`, { method: 'POST' });
  }

  public async deleteDoc(docId: string): Promise<void> {
    await this.request(`${this._url}/api/docs/${docId}`, { method: 'DELETE' });
  }

  public async softDeleteDoc(docId: string): Promise<void> {
    await this.request(`${this._url}/api/docs/${docId}/remove`, { method: 'POST' });
  }

  public async undeleteDoc(docId: string): Promise<void> {
    await this.request(`${this._url}/api/docs/${docId}/unremove`, { method: 'POST' });
  }

  public async updateOrgPermissions(orgId: number|string, delta: PermissionDelta): Promise<void> {
    await this.request(`${this._url}/api/orgs/${orgId}/access`, {
      method: 'PATCH',
      body: JSON.stringify({ delta })
    });
  }

  public async updateWorkspacePermissions(workspaceId: number, delta: PermissionDelta): Promise<void> {
    await this.request(`${this._url}/api/workspaces/${workspaceId}/access`, {
      method: 'PATCH',
      body: JSON.stringify({ delta })
    });
  }

  public async updateDocPermissions(docId: string, delta: PermissionDelta): Promise<void> {
    await this.request(`${this._url}/api/docs/${docId}/access`, {
      method: 'PATCH',
      body: JSON.stringify({ delta })
    });
  }

  public async getOrgAccess(orgId: number|string): Promise<PermissionData> {
    return this.requestJson(`${this._url}/api/orgs/${orgId}/access`, { method: 'GET' });
  }

  public async getWorkspaceAccess(workspaceId: number): Promise<PermissionData> {
    return this.requestJson(`${this._url}/api/workspaces/${workspaceId}/access`, { method: 'GET' });
  }

  public async getDocAccess(docId: string): Promise<PermissionData> {
    return this.requestJson(`${this._url}/api/docs/${docId}/access`, { method: 'GET' });
  }

  public async pinDoc(docId: string): Promise<void> {
    await this.request(`${this._url}/api/docs/${docId}/pin`, {
      method: 'PATCH'
    });
  }

  public async unpinDoc(docId: string): Promise<void> {
    await this.request(`${this._url}/api/docs/${docId}/unpin`, {
      method: 'PATCH'
    });
  }

  public async moveDoc(docId: string, workspaceId: number): Promise<void> {
    await this.request(`${this._url}/api/docs/${docId}/move`, {
      method: 'PATCH',
      body: JSON.stringify({ workspace: workspaceId })
    });
  }

  public async getUserProfile(): Promise<FullUser> {
    return this.requestJson(`${this._url}/api/profile/user`);
  }

  public async updateUserName(name: string): Promise<void> {
    await this.request(`${this._url}/api/profile/user/name`, {
      method: 'POST',
      body: JSON.stringify({name})
    });
  }

  public async getWorker(key: string): Promise<string> {
    const json = await this.requestJson(`${this._url}/api/worker/${key}`, {
      method: 'GET',
      credentials: 'include'
    });
    return json.docWorkerUrl;
  }

  public async getWorkerAPI(key: string): Promise<DocWorkerAPI> {
    const docUrl = this._urlWithOrg(await this.getWorker(key));
    return new DocWorkerAPIImpl(docUrl, this._options);
  }

  public getBillingAPI(): BillingAPI {
    return new BillingAPIImpl(this._url, this._options);
  }

  public getDocAPI(docId: string): DocAPI {
    return new DocAPIImpl(this._url, docId, this._options);
  }

  public async fetchApiKey(): Promise<string> {
    const resp = await this.fetch(`${this._url}/api/profile/apiKey`, {
      credentials: 'include'
    });
    return await resp.text();
  }

  public async createApiKey(): Promise<string> {
    const res = await this.fetch(`${this._url}/api/profile/apiKey`, {credentials: 'include', method: 'POST'});
    return await res.text();
  }

  public async deleteApiKey(): Promise<void> {
    await this.fetch(`${this._url}/api/profile/apiKey`, {credentials: 'include', method: 'DELETE'});
  }

  // This method is not strictly needed anymore, but is widely used by
  // tests so supporting as a handy shortcut for getDocAPI(docId).getRows(tableName)
  public async getTable(docId: string, tableName: string): Promise<TableColValues> {
    return this.getDocAPI(docId).getRows(tableName);
  }

  public async applyUserActions(docId: string, actions: UserAction[]): Promise<ApplyUAResult> {
    return this.requestJson(`${this._url}/api/docs/${docId}/apply`, {
      method: 'POST',
      body: JSON.stringify(actions)
    });
  }

  public async importUnsavedDoc(material: UploadType, options?: {
    filename?: string,
    timezone?: string,
    onUploadProgress?: (ev: ProgressEvent) => void,
  }): Promise<string> {
    options = options || {};
    const formData = this.newFormData();
    formData.append('upload', material as any, options.filename);
    if (options.timezone) { formData.append('timezone', options.timezone); }
    const resp = await this.requestAxios(`${this._url}/api/docs`, {
      headers: this._options.headers,
      method: 'POST',
      data: formData,
      onUploadProgress: options.onUploadProgress,
    });
    return resp.data;
  }

  public async deleteUser(userId: number, name: string) {
    await this.request(`${this._url}/api/users/${userId}`,
                       {method: 'DELETE',
                        body: JSON.stringify({name})});
  }

  public getBaseUrl(): string { return this._url; }

  // Recomputes the URL on every call to pick up changes in the URL when switching orgs.
  // (Feels inefficient, but probably doesn't matter, and it's simpler than the alternatives.)
  private get _url(): string {
    return this._urlWithOrg(this._homeUrl);
  }

  private _urlWithOrg(base: string): string {
    return isClient() ? addCurrentOrgToPath(base) : base.replace(/\/$/, '');
  }
}

export class DocWorkerAPIImpl extends BaseAPI implements DocWorkerAPI {
  constructor(readonly url: string, private _options: IOptions = {}) {
    super(_options);
  }

  public async importDocToWorkspace(uploadId: number, workspaceId: number, browserSettings?: BrowserSettings)
    : Promise<DocCreationInfo> {
    return this.requestJson(`${this.url}/api/workspaces/${workspaceId}/import`, {
      method: 'POST',
      body: JSON.stringify({ uploadId, browserSettings })
    });
  }

  public async upload(material: UploadType, filename?: string): Promise<number> {
    const formData = this.newFormData();
    formData.append('upload', material as any, filename);
    const json = await this.requestJson(`${this.url}/uploads`, {
      headers: this._options.headers,
      method: 'POST',
      body: formData
    });
    return json.uploadId;
  }

  public async downloadDoc(docId: string, template: boolean = false): Promise<Response> {
    const extra = template ? '&template=1' : '';
    const result = await this.request(`${this.url}/download?doc=${docId}${extra}`, {
      headers: this._options.headers,
      method: 'GET',
    });
    if (!result.ok) { throw new Error(await result.text()); }
    return result;
  }

  public async copyDoc(docId: string, template: boolean = false, name?: string): Promise<number> {
    const url = new URL(`${this.url}/copy?doc=${docId}`);
    if (template) {
      url.searchParams.append('template', '1');
    }
    if (name) {
      url.searchParams.append('name', name);
    }
    const json = await this.requestJson(url.href, {
      headers: this._options.headers,
      method: 'POST',
    });
    return json.uploadId;
  }
}

export class DocAPIImpl extends BaseAPI implements DocAPI {
  private _url: string;

  constructor(url: string, readonly docId: string, options: IOptions = {}) {
    super(options);
    this._url = `${url}/api/docs/${docId}`;
  }

  public async getRows(tableId: string): Promise<TableColValues> {
    return this.requestJson(`${this._url}/tables/${tableId}/data`);
  }

  public async updateRows(tableId: string, changes: TableColValues): Promise<number[]> {
    return this.requestJson(`${this._url}/tables/${tableId}/data`, {
      body: JSON.stringify(changes),
      method: 'PATCH'
    });
  }

  public async addRows(tableId: string, additions: BulkColValues): Promise<number[]> {
    return this.requestJson(`${this._url}/tables/${tableId}/data`, {
      body: JSON.stringify(additions),
      method: 'POST'
    });
  }

  public async replace(source: DocReplacementOptions): Promise<void> {
    return this.requestJson(`${this._url}/replace`, {
      body: JSON.stringify(source),
      method: 'POST'
    });
  }

  public async getSnapshots(): Promise<DocSnapshots> {
    return this.requestJson(`${this._url}/snapshots`);
  }

  public async forceReload(): Promise<void> {
    await this.request(`${this._url}/force-reload`, {
      method: 'POST'
    });
  }

  public async compareState(remoteDocId: string): Promise<DocStateComparison> {
    return this.requestJson(`${this._url}/compare/${remoteDocId}`);
  }
}