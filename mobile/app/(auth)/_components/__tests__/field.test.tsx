import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Field } from '../field';

jest.mock('@expo/vector-icons');

describe('Field', () => {
  it('renders a plain text field with no toggle when secureTextEntry is not set', () => {
    const { getByLabelText, queryByLabelText } = render(<Field label="Email" value="" onChangeText={jest.fn()} />);
    expect(getByLabelText('Email').props.secureTextEntry).toBeFalsy();
    expect(queryByLabelText('Show password')).toBeNull();
    expect(queryByLabelText('Hide password')).toBeNull();
  });

  it('masks a password field by default and reveals it on toggle (session 2026-10-15: "add feature to allow viewing password")', () => {
    const { getByLabelText, queryByLabelText } = render(
      <Field label="Password" value="hunter2" onChangeText={jest.fn()} secureTextEntry />,
    );

    expect(getByLabelText('Password').props.secureTextEntry).toBe(true);
    expect(queryByLabelText('Hide password')).toBeNull();

    fireEvent.press(getByLabelText('Show password'));
    expect(getByLabelText('Password').props.secureTextEntry).toBe(false);
    expect(queryByLabelText('Show password')).toBeNull();

    fireEvent.press(getByLabelText('Hide password'));
    expect(getByLabelText('Password').props.secureTextEntry).toBe(true);
  });
});
