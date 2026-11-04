import { Converter, ReflectionKind } from 'typedoc';
import ts from 'typescript';

export function load(app) {
  app.converter.on(Converter.EVENT_CREATE_DECLARATION, (context, reflection) => {
    if (!reflection.kindOf(ReflectionKind.Class) || reflection.name !== 'default') return;

    const declaration = context.getSymbolFromReflection(reflection)?.valueDeclaration;
    if (declaration && ts.isClassDeclaration(declaration) && declaration.name) {
      reflection.name = declaration.name.text;
    }
  });
}
