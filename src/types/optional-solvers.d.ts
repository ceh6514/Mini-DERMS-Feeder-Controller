declare module 'javascript-lp-solver' {
  const Solver: {
    Solve: (model: unknown) => Record<string, number | boolean | string> & {
      feasible?: boolean;
      bounded?: boolean;
    };
  };
  export = Solver;
}
