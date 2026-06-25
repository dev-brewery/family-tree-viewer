// Gramps Web API client
// Fetches people, families, and media from the Gramps Web REST API

const API_BASE =
  (typeof window !== 'undefined' && window.__VIEWER_CONFIG__?.GRAMPS_API_URL) ||
  import.meta.env.VITE_GRAMPS_API_URL ||
  '/api';

let authToken = null;

export function setToken(token) {
  authToken = token;
}

/** Current access token (for <img> ?jwt= URLs that can't send auth headers). */
export function getToken() {
  return authToken;
}

/**
 * Build a thumbnail URL for a media handle. <img> tags cannot send the
 * Authorization header, so the token is passed via the `?jwt=` query param
 * (honored by the Gramps API). Returns '' when there is no handle.
 */
export function mediaThumbUrl(handle, size = 200) {
  if (!handle) return '';
  const jwt = authToken ? `?jwt=${encodeURIComponent(authToken)}` : '';
  return `${API_BASE}/media/${handle}/thumbnail/${size}${jwt}`;
}

/** Full-size media file URL for a handle (same `?jwt=` auth approach). */
export function mediaFileUrl(handle) {
  if (!handle) return '';
  const jwt = authToken ? `?jwt=${encodeURIComponent(authToken)}` : '';
  return `${API_BASE}/media/${handle}/file${jwt}`;
}

async function apiFetch(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return res.json();
  }
  return res.text();
}

/**
 * Fetch all people with pagination
 */
export async function fetchPeople() {
  const people = [];
  let page = 1;
  const perPage = 100;
  let hasMore = true;

  while (hasMore) {
    // profile=all returns formatted birth/death/place strings. extend=families
    // is NOT compatible with profile=all (live API returns 422), so it is dropped.
    const data = await apiFetch(`/people/?page=${page}&pagesize=${perPage}&profile=all`);
    if (Array.isArray(data)) {
      people.push(...data);
      hasMore = data.length === perPage;
    } else if (data.data) {
      people.push(...data.data);
      hasMore = data.data.length === perPage;
    } else {
      people.push(...(data.results || []));
      hasMore = (data.next != null);
    }
    page++;
    if (page > 50) break; // safety valve
  }

  return people;
}

/**
 * Fetch all families
 */
export async function fetchFamilies() {
  const families = [];
  let page = 1;
  const perPage = 100;
  let hasMore = true;

  while (hasMore) {
    // The base family object already includes father_handle / mother_handle /
    // child_ref_list, so no `extend` is needed. `extend=father,mother,children`
    // is invalid for /families/ (live API returns 422 — valid keys are
    // father_handle, mother_handle, etc.), so it is omitted.
    const data = await apiFetch(`/families/?page=${page}&pagesize=${perPage}`);
    if (Array.isArray(data)) {
      families.push(...data);
      hasMore = data.length === perPage;
    } else if (data.data) {
      families.push(...data.data);
      hasMore = data.data.length === perPage;
    } else {
      families.push(...(data.results || []));
      hasMore = (data.next != null);
    }
    page++;
    if (page > 50) break;
  }

  return families;
}

/**
 * Fetch media for a person
 */
export async function fetchPersonMedia(personHandle) {
  try {
    const data = await apiFetch(`/people/${personHandle}/?extend=media`);
    return data?.extended?.media || [];
  } catch {
    return [];
  }
}

/**
 * Login to get JWT token
 */
export async function login(username, password) {
  const data = await apiFetch('/token/', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (data.access_token) {
    authToken = data.access_token;
    // Return both tokens so the caller can schedule silent refresh.
    return { access_token: data.access_token, refresh_token: data.refresh_token };
  }
  throw new Error('No access token in response');
}

/**
 * Exchange a refresh token for a fresh access token.
 * POST /token/refresh/ with Authorization: Bearer <refreshToken>.
 */
export async function refreshToken(refreshTokenValue) {
  const res = await fetch(`${API_BASE}/token/refresh/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${refreshTokenValue}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Token refresh failed ${res.status}: ${res.statusText}`);
  }
  const data = await res.json();
  if (data.access_token) {
    authToken = data.access_token;
    return data.access_token;
  }
  throw new Error('No access token in refresh response');
}

/**
 * Transform Gramps people + families into family-chart data format
 * family-chart expects: { id, data: { first_name, last_name, gender, birth_date, death_date, avatar, ... } }
 * with relationships: parents, spouses, children (by id)
 */
export function transformToFamilyChart(people, families) {
  const persons = {};
  const links = {}; // id -> { parents: [], spouses: [], children: [] }

  // Index people
  for (const p of people) {
    const handle = p.handle || p.gramps_id;
    const name = p.primary_name || {};
    persons[handle] = {
      id: handle,
      data: {
        first_name: name.first_name || '',
        last_name: name.surname_list?.[0]?.surname || name.surname || '',
        gender: p.gender === 1 ? 'M' : p.gender === 0 ? 'F' : 'U',
        // profile.* dates/places are already display-formatted strings (e.g. "1808").
        birth_date: p.profile?.birth?.date || '',
        death_date: p.profile?.death?.date || '',
        birth_place: p.profile?.birth?.place || p.profile?.birth?.place_name || '',
        death_place: p.profile?.death?.place || p.profile?.death?.place_name || '',
        gramps_id: p.gramps_id || handle,
        // First media handle (binary may 404 on metadata-only imports; the UI
        // falls back to initials). Used to build thumbnail/file URLs.
        media_handle: p.media_list?.[0]?.ref || '',
      },
    };
    links[handle] = { parents: [], spouses: [], children: [] };
  }

  // A child can belong to several families (birth, step, adoptive). family-chart
  // only models one father + one mother per person and throws ("child has more
  // than 1 parent") if a child's parents array exceeds 2. So pick a single
  // "primary" family per child — preferring one flagged as a Birth relationship,
  // otherwise the first family that lists them.
  const childPrimaryFamily = {}; // childHandle -> family object
  for (const f of families) {
    for (const cref of (f.child_ref_list || [])) {
      const ch = cref.ref;
      if (!persons[ch]) continue;
      const isBirth = cref.frel === 'Birth' || cref.mrel === 'Birth';
      if (!childPrimaryFamily[ch]) {
        childPrimaryFamily[ch] = { f, isBirth };
      } else if (isBirth && !childPrimaryFamily[ch].isBirth) {
        childPrimaryFamily[ch] = { f, isBirth }; // upgrade to a birth family
      }
    }
  }

  // Process families to build relationships
  for (const f of families) {
    const fatherHandle = f.father_handle;
    const motherHandle = f.mother_handle;
    const childHandles = f.child_ref_list?.map(c => c.ref) || [];

    // Link spouses
    if (fatherHandle && motherHandle && persons[fatherHandle] && persons[motherHandle]) {
      if (!links[fatherHandle].spouses.includes(motherHandle)) {
        links[fatherHandle].spouses.push(motherHandle);
      }
      if (!links[motherHandle].spouses.includes(fatherHandle)) {
        links[motherHandle].spouses.push(fatherHandle);
      }
    }

    // Link children to parents — only for the child's primary family, so no
    // child ever accumulates more than two parents.
    for (const childHandle of childHandles) {
      if (persons[childHandle] && childPrimaryFamily[childHandle]?.f === f) {
        if (fatherHandle && !links[childHandle].parents.includes(fatherHandle)) {
          links[childHandle].parents.push(fatherHandle);
        }
        if (motherHandle && !links[childHandle].parents.includes(motherHandle)) {
          links[childHandle].parents.push(motherHandle);
        }
        if (fatherHandle && !links[fatherHandle].children.includes(childHandle)) {
          links[fatherHandle].children.push(childHandle);
        }
        if (motherHandle && !links[motherHandle].children.includes(childHandle)) {
          links[motherHandle].children.push(childHandle);
        }
      }
    }
  }

  return { persons, links };
}
