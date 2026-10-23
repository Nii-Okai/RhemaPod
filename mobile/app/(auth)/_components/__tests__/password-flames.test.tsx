import React from 'react';
import { render } from '@testing-library/react-native';
import { isServerCommonPassword, PasswordFlames, passwordStrength } from '../password-flames';

describe('PasswordFlames', () => {
  it('states the minimum before anything is typed', () => {
    expect(render(<PasswordFlames password="" />).getByText('At least 12 characters.')).toBeTruthy();
  });

  it('counts down the characters still needed', () => {
    expect(render(<PasswordFlames password="Xk9#mQ2$vL4" />).getByText('1 more character.')).toBeTruthy();
    expect(render(<PasswordFlames password="Xk9#m" />).getByText('7 more characters.')).toBeTruthy();
  });

  it('names the strength once the minimum is met', () => {
    expect(render(<PasswordFlames password="river-Lantern-47-oak!" />).getByText('Very strong.')).toBeTruthy();
  });

  it('flags a password the server would reject as common', () => {
    expect(render(<PasswordFlames password="password1234" />).getByText('Too common. Choose something less predictable.')).toBeTruthy();
  });
});

describe('passwordStrength', () => {
  it('scores by more than length', () => {
    expect(passwordStrength('aaaaaaaaaaaaaaaa').score).toBe(0);
    expect(passwordStrength('abcdefghijklmnop').score).toBeLessThanOrEqual(1);
    expect(passwordStrength('Password2026!!').score).toBeLessThanOrEqual(2);
    expect(passwordStrength('river-Lantern-47-oak!').score).toBe(4);
  });

  it('never rates a too-short password above weak', () => {
    expect(passwordStrength('Xk9#mQ2$').score).toBeLessThanOrEqual(1);
  });
});

describe('isServerCommonPassword', () => {
  it('matches the backend, including trailing digits and bangs', () => {
    expect(isServerCommonPassword('Password1234')).toBe(true);
    expect(isServerCommonPassword('password!!!')).toBe(true);
    expect(isServerCommonPassword('correct horse battery')).toBe(false);
  });
});
