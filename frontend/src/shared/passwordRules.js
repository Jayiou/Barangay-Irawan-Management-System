export const PASSWORD_REQUIREMENTS_MESSAGE = 'Password must be at least 8 characters and include uppercase, lowercase, number, and a special character (_ | @ $ ! % * ? &).';

const PASSWORD_SPECIAL_CHAR_REGEX = /[_|@$!%*?&]/;

export const getPasswordRequirementRules = (password, confirmPassword = null) => {
    const value = String(password || '');
    const rules = [
        { key: 'min-length', label: 'At least 8 characters', passed: value.length >= 8 },
        { key: 'uppercase', label: 'At least 1 uppercase letter (A-Z)', passed: /[A-Z]/.test(value) },
        { key: 'lowercase', label: 'At least 1 lowercase letter (a-z)', passed: /[a-z]/.test(value) },
        { key: 'number', label: 'At least 1 number (0-9)', passed: /\d/.test(value) },
        { key: 'special', label: 'At least 1 special character (_ | @ $ ! % * ? &)', passed: PASSWORD_SPECIAL_CHAR_REGEX.test(value) }
    ];

    if (confirmPassword !== null) {
        rules.push({
            key: 'match',
            label: 'Confirm password matches',
            passed: Boolean(value) && value === String(confirmPassword || '')
        });
    }

    return rules;
};

export const isStrongPassword = (password) => getPasswordRequirementRules(password).every((rule) => rule.passed);
