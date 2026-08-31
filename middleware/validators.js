export const isValidUUID = (uuid) => {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
};

export const isValidEmail = (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

export const normalizeEmail = (email) => {
    if (typeof email !== 'string') return '';
    return email.trim().toLowerCase();
};

export const isValidPassword = (password) => {
    return typeof password === 'string' && password.length >= 8;
};

export const isValidTenantRole = (role) => {
    return ['ADMIN', 'AGENT'].includes(role);
};
