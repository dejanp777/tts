"""
Bayesian Optimization for Parameter Tuning

More efficient than grid search - intelligently explores parameter space
"""
import json
from pathlib import Path
from typing import Dict, Any
import sys

# Add parent to path
sys.path.append(str(Path(__file__).parent.parent))

try:
    from bayes_opt import BayesianOptimization
    from bayes_opt.logger import JSONLogger
    from bayes_opt.event import Events
    BAYESOPT_AVAILABLE = True
except ImportError:
    BAYESOPT_AVAILABLE = False
    print("bayesian-optimization not installed. Install with: pip install bayesian-optimization")


class BayesianParameterOptimizer:
    """
    Uses Bayesian Optimization to find optimal parameters
    """

    def __init__(self, output_dir: Path):
        if not BAYESOPT_AVAILABLE:
            raise ImportError("bayesian-optimization package required")

        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.iteration = 0

    def objective_function(self, silence_threshold, backchannel_duration_threshold,
                          backchannel_intensity_threshold, barge_in_threshold):
        """
        Objective function to maximize

        Args:
            silence_threshold: Silence threshold (500-3000ms)
            backchannel_duration_threshold: Backchannel duration threshold (300-1000ms)
            backchannel_intensity_threshold: Backchannel intensity (0.02-0.06)
            barge_in_threshold: Barge-in threshold (200-500ms)

        Returns:
            Score to maximize (higher is better)
        """
        self.iteration += 1

        params = {
            'silence_threshold_ms': int(silence_threshold),
            'backchannel_duration_threshold_ms': int(backchannel_duration_threshold),
            'backchannel_intensity_threshold': backchannel_intensity_threshold,
            'barge_in_threshold_ms': int(barge_in_threshold)
        }

        print(f"\n{'='*80}")
        print(f"Iteration {self.iteration}")
        print(f"{'='*80}")
        print("Testing parameters:")
        for k, v in params.items():
            print(f"  {k}: {v}")

        # Set configuration
        self.set_config(params)

        # Run test suite
        metrics = self.run_test_suite(params)

        # Calculate composite score
        score = self.calculate_score(metrics)

        print(f"\nMetrics:")
        for k, v in metrics.items():
            if isinstance(v, float):
                print(f"  {k}: {v:.4f}")
            else:
                print(f"  {k}: {v}")
        print(f"\nScore: {score:.4f}")
        print(f"{'='*80}")

        return score

    def set_config(self, params: Dict[str, Any]):
        """Set application configuration"""
        # TODO: Implement actual config setting
        pass

    def run_test_suite(self, params: Dict[str, Any]) -> Dict[str, float]:
        """Run test suite with given parameters"""
        # TODO: Actually run tests
        # For now, simulate with placeholder

        import random
        random.seed(hash(frozenset(params.items())))

        metrics = {
            'turn_taking_accuracy': 0.85 + random.random() * 0.10,
            'false_interruption_rate': 0.05 + random.random() * 0.10,
            'avg_latency_ms': 1200 + random.random() * 800,
            'stt_wer': 0.02 + random.random() * 0.03,
        }

        return metrics

    def calculate_score(self, metrics: Dict[str, float]) -> float:
        """Calculate composite score"""
        score = (
            metrics.get('turn_taking_accuracy', 0) * 0.4 +
            (1 - metrics.get('false_interruption_rate', 0)) * 0.3 +
            (1 - min(metrics.get('avg_latency_ms', 2000) / 3000, 1.0)) * 0.2 +
            (1 - metrics.get('stt_wer', 0) * 10) * 0.1
        )
        return score

    def optimize(self, init_points: int = 5, n_iter: int = 20):
        """
        Run Bayesian Optimization

        Args:
            init_points: Number of random exploration points
            n_iter: Number of optimization iterations

        Returns:
            Best parameters found
        """
        print(f"\n{'='*80}")
        print(f"BAYESIAN OPTIMIZATION")
        print(f"{'='*80}")
        print(f"Initial random points: {init_points}")
        print(f"Optimization iterations: {n_iter}")
        print(f"Total evaluations: {init_points + n_iter}")
        print(f"{'='*80}\n")

        # Define parameter bounds
        pbounds = {
            'silence_threshold': (500, 3000),
            'backchannel_duration_threshold': (300, 1000),
            'backchannel_intensity_threshold': (0.02, 0.06),
            'barge_in_threshold': (200, 500)
        }

        # Create optimizer
        optimizer = BayesianOptimization(
            f=self.objective_function,
            pbounds=pbounds,
            random_state=42,
            verbose=2
        )

        # Set up logger
        logger_file = self.output_dir / "bayesian_opt_log.json"
        logger = JSONLogger(path=str(logger_file))
        optimizer.subscribe(Events.OPTIMIZATION_STEP, logger)

        # Run optimization
        optimizer.maximize(
            init_points=init_points,
            n_iter=n_iter
        )

        # Get best parameters
        best_params = optimizer.max['params']
        best_score = optimizer.max['target']

        # Convert to proper types
        best_params_typed = {
            'silence_threshold_ms': int(best_params['silence_threshold']),
            'backchannel_duration_threshold_ms': int(best_params['backchannel_duration_threshold']),
            'backchannel_intensity_threshold': best_params['backchannel_intensity_threshold'],
            'barge_in_threshold_ms': int(best_params['barge_in_threshold'])
        }

        print(f"\n{'='*80}")
        print(f"🏆 OPTIMIZATION COMPLETE")
        print(f"{'='*80}")
        print(f"Best score: {best_score:.4f}\n")
        print("Best parameters:")
        for k, v in best_params_typed.items():
            print(f"  {k}: {v}")
        print(f"{'='*80}\n")

        # Save results
        results = {
            'best_params': best_params_typed,
            'best_score': best_score,
            'all_iterations': [
                {
                    'params': {
                        'silence_threshold_ms': int(res['params']['silence_threshold']),
                        'backchannel_duration_threshold_ms': int(res['params']['backchannel_duration_threshold']),
                        'backchannel_intensity_threshold': res['params']['backchannel_intensity_threshold'],
                        'barge_in_threshold_ms': int(res['params']['barge_in_threshold'])
                    },
                    'score': res['target']
                }
                for res in optimizer.res
            ]
        }

        results_file = self.output_dir / "bayesian_opt_results.json"
        with open(results_file, 'w') as f:
            json.dump(results, f, indent=2)

        print(f"Results saved to: {results_file}")
        print(f"Log saved to: {logger_file}")

        return best_params_typed

    def plot_convergence(self):
        """Plot optimization convergence"""
        try:
            import matplotlib.pyplot as plt
            import numpy as np

            # Load results
            results_file = self.output_dir / "bayesian_opt_results.json"
            with open(results_file, 'r') as f:
                results = json.load(f)

            iterations = range(1, len(results['all_iterations']) + 1)
            scores = [it['score'] for it in results['all_iterations']]
            best_so_far = np.maximum.accumulate(scores)

            plt.figure(figsize=(10, 6))
            plt.plot(iterations, scores, 'o-', label='Score', alpha=0.6)
            plt.plot(iterations, best_so_far, 'r-', label='Best so far', linewidth=2)
            plt.xlabel('Iteration')
            plt.ylabel('Score')
            plt.title('Bayesian Optimization Convergence')
            plt.legend()
            plt.grid(True, alpha=0.3)

            plot_file = self.output_dir / "bayesian_opt_convergence.png"
            plt.savefig(plot_file, dpi=150)
            print(f"Convergence plot saved to: {plot_file}")

        except ImportError:
            print("matplotlib not available, skipping plot")


def main():
    """Main entry point"""
    if not BAYESOPT_AVAILABLE:
        print("Error: bayesian-optimization package not installed")
        print("Install with: pip install bayesian-optimization")
        return

    output_dir = Path(__file__).parent / "results"

    optimizer = BayesianParameterOptimizer(output_dir)
    best_params = optimizer.optimize(init_points=5, n_iter=20)

    # Plot convergence
    optimizer.plot_convergence()

    print("\n✓ Bayesian optimization complete")
    print("\nRecommended configuration:")
    print(json.dumps(best_params, indent=2))


if __name__ == "__main__":
    main()
