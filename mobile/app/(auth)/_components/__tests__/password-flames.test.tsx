import React from 'react';
import { render } from '@testing-library/react-native';
import { PasswordFlames } from '../password-flames';

describe('PasswordFlames', () => {
  it('states the minimum before anything is typed', () => {
    expect(render(<PasswordFlames length={0} />).getByText('At least 12 characters.')).toBeTruthy();
  });

  it('counts down the characters still needed', () => {
    expect(render(<PasswordFlames length={11} />).getByText('1 more character.')).toBeTruthy();
    expect(render(<PasswordFlames length={5} />).getByText('7 more characters.')).toBeTruthy();
  });

  it('confirms once the minimum is met', () => {
    expect(render(<PasswordFlames length={20} />).getByText('Long enough.')).toBeTruthy();
  });
});
