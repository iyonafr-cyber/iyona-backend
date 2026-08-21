import {
  parsePlanEntityContracts,
  lintPlanEntityContracts,
} from './plan-entity-contract';

/** A plan fragment shaped the way the build-spec prompt asks for. */
function planWith(fieldsLine: string): string {
  return `
## 5. Pages

### Add car
- **Route** /cars/new and **component name** AddCarPage
- **Purpose** let a seller list a car
- **Layout** form card with sections
${fieldsLine}

## 6. Data & state

Car
| field | type | required | source |
| id | string | yes | system |
| createdAt | string | yes | system |
| image | string | yes | user |
| title | string | yes | user |
| model | string | yes | user |
| year | number | yes | user |
| condition | string | yes | user |
| price | number | yes | user |
| description | string | no | user |
`;
}

describe('parsePlanEntityContracts', () => {
  it('splits user and system fields and names the entity', () => {
    const contracts = parsePlanEntityContracts(planWith('- **Fields**: title'));
    expect(contracts).toHaveLength(1);
    expect(contracts[0].name).toBe('Car');
    expect(contracts[0].userFields).toEqual([
      'image',
      'title',
      'model',
      'year',
      'condition',
      'price',
      'description',
    ]);
    expect(contracts[0].systemFields).toEqual(['id', 'createdAt']);
  });

  it('returns nothing for a plan with no field table', () => {
    expect(parsePlanEntityContracts('## 6. Data & state\nJust prose.')).toEqual(
      [],
    );
  });
});

describe('lintPlanEntityContracts', () => {
  it('flags a form field list that omits user fields', () => {
    const violations = lintPlanEntityContracts(
      planWith('- **Fields**: title (text), year (number), price (number)'),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].entity).toBe('Car');
    expect(violations[0].formFieldsUndeclared).toBe(false);
    expect(violations[0].missingFromForm.sort()).toEqual(
      ['condition', 'description', 'image', 'model'].sort(),
    );
  });

  it('passes when the form covers every user field', () => {
    const violations = lintPlanEntityContracts(
      planWith(
        '- **Fields**: image (URL), title (text), model (text), year (number), condition (select), price (number), description (textarea)',
      ),
    );
    expect(violations).toEqual([]);
  });

  it('never demands system fields on the form', () => {
    const violations = lintPlanEntityContracts(
      planWith(
        '- **Fields**: image (URL), title (text), model (text), year (number), condition (select), price (number), description (textarea)',
      ),
    );
    // id / createdAt are `system` — their absence must not be reported.
    expect(violations).toEqual([]);
  });

  it('flags an entity whose create screen declares no fields at all', () => {
    const plan = planWith('- **Primary interactions** submit the form');
    const violations = lintPlanEntityContracts(plan);
    expect(violations).toHaveLength(1);
    expect(violations[0].formFieldsUndeclared).toBe(true);
    expect(violations[0].entity).toBe('Car');
  });

  it('gives no parity verdict when a field list spans two entities', () => {
    const plan = `
## 5. Pages

### Add vehicle
- **Route** /vehicles/new — handles both Car and Van records
- **Fields**: title (text)

## 6. Data & state

Car
| field | type | required | source |
| id | string | yes | system |
| image | string | yes | user |
| title | string | yes | user |
| model | string | yes | user |
| year | number | yes | user |

Van
| field | type | required | source |
| id | string | yes | system |
| image | string | yes | user |
| title | string | yes | user |
| axles | number | yes | user |
| year | number | yes | user |
`;
    // Both entities appear in the same page context → no confident verdict,
    // and neither has an attributable write screen of its own.
    const violations = lintPlanEntityContracts(plan);
    for (const v of violations) expect(v.formFieldsUndeclared).toBe(true);
    expect(violations.every((v) => v.missingFromForm.length > 0)).toBe(true);
  });
});
