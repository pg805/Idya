import Result_Field from '../../infrastructure/result_field.js';
import Action, { ActionType } from '../action.js';

// Destroy Obstacle (12): aimed at an obstacle tile in range. Destroys it and
// deals `field` (rolled) to every enemy within 1 tile of the obstacle.
export default class DestroyObstacle extends Action {
    field: Result_Field;
    type = ActionType.DestroyObstacle;
    type_name = 'DESTROY OBSTACLE';

    constructor(name: string, action_string: string, field: Result_Field) {
        super(name, action_string);
        this.field = field;
    }

    get_description(): string {
        return `DESTROY OBSTACLE [${this.field.field}]`;
    }
}
