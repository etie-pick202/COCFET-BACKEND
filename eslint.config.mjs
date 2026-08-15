// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  // Les mêmes règles que SonarCloud, exécutées ici.
  //
  // Sans elles, on découvrait les signalements après la poussée, dans les
  // commentaires de la pull request — c'est-à-dire au moment le plus coûteux :
  // la CI a tourné, la revue est lancée, et chaque correction repart pour un
  // tour. `pnpm run lint` les remonte désormais avant le commit.
  sonarjs.configs.recommended,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // Comparer directement a « Role.ADMIN » laisse le role d'exploitation en
      // dehors : il se retrouverait moins puissant que l'administration
      // ordinaire, soit l'inverse de ce qu'il doit etre. « estAdministrateur »
      // est le seul test autorise, et cette regle empeche le code a venir de
      // rouvrir la breche par inadvertance.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "BinaryExpression[operator=/^(===|!==|==|!=)$/] > MemberExpression.right[property.name='ADMIN'][object.name='Role']",
          message:
            'Utilisez estAdministrateur() : comparer a Role.ADMIN exclut SUPER_ADMIN.',
        },
        {
          selector:
            "BinaryExpression[operator=/^(===|!==|==|!=)$/] > MemberExpression.left[property.name='ADMIN'][object.name='Role']",
          message:
            'Utilisez estAdministrateur() : comparer a Role.ADMIN exclut SUPER_ADMIN.',
        },
      ],

      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  {
    // Dans les tests, « expect(monMock.methode) » est le motif normal de
    // vérification d'un appel. La règle unbound-method y voit une méthode
    // détachée de son objet, ce qui n'a pas de sens pour un mock Jest.
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    // `.expect(403)` de supertest **est** une assertion : elle lève quand le
    // statut diffère. La règle ne connaît que `expect()` de Jest et voit donc
    // un test sans vérification là où il y en a une.
    //
    // Ce qu'on perd en la désactivant : un test end-to-end qui n'assérerait
    // vraiment rien ne serait plus signalé. Le compromis est assumé — la
    // réécrire mécaniquement en `expect(reponse.status).toBe(403)` ajouterait
    // du bruit sans rien vérifier de plus.
    files: ['test/**/*.e2e-spec.ts'],
    rules: {
      'sonarjs/assertions-in-tests': 'off',
    },
  },
);
