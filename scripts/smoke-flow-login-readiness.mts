import { isFlowLoginReady } from '../src/lib/flow-bridge/bootstrap';

const cases = [
  {
    name: 'bare token must keep login open',
    input: {
      email: '',
      sessionVerified: false,
      flowKeyPresent: true,
      freshTokenPresent: true,
    },
    expected: false,
  },
  {
    name: 'email without token is not ready',
    input: {
      email: 'user@example.com',
      sessionVerified: false,
      flowKeyPresent: false,
      freshTokenPresent: false,
    },
    expected: false,
  },
  {
    name: 'verified email plus token is ready',
    input: {
      email: 'user@example.com',
      sessionVerified: true,
      flowKeyPresent: true,
      freshTokenPresent: true,
    },
    expected: true,
  },
];

let failed = false;
for (const testCase of cases) {
  const actual = isFlowLoginReady(testCase.input);
  console.log(
    `[flow-login-readiness] ${testCase.name}: actual=${actual} expected=${testCase.expected}`,
  );
  if (actual !== testCase.expected) failed = true;
}

if (failed) {
  console.error('[flow-login-readiness] FAIL');
  process.exit(1);
}

console.log('[flow-login-readiness] PASS');
