import { ValidationError } from '@nestjs/common';
import { IdParamPipe } from './id-param.pipe';
import { flattenValidationErrors } from './validation.pipe';

describe('IdParamPipe', () => {
  const pipe = new IdParamPipe();

  it('parses positive integers', () => {
    expect(pipe.transform('42')).toBe(42);
  });

  it.each(['abc', '0', '-1', '1.5', '', '99999999999', ' 1'])('rejects %p', (value) => {
    expect(() => pipe.transform(value)).toThrow('Validation failed');
  });
});

describe('flattenValidationErrors', () => {
  it('flattens nested errors into dotted/indexed field paths', () => {
    const errors = [
      { property: 'name', constraints: { isNotEmpty: 'name should not be empty' } },
      {
        property: 'items',
        children: [
          {
            property: '0',
            children: [
              { property: 'quantity', constraints: { min: 'quantity must not be less than 1' } },
            ],
          },
        ],
      },
    ] as ValidationError[];

    expect(flattenValidationErrors(errors)).toEqual([
      { field: 'name', messages: ['name should not be empty'] },
      { field: 'items[0].quantity', messages: ['quantity must not be less than 1'] },
    ]);
  });
});
