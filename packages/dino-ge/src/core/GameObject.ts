import Registry from './Registry.js';
import Component from './Component.js';
import TransformComponent from '../components/TransformComponent.js';
import TagComponent from '../components/TagComponent.js';
import BoundsComponent from '../components/BoundsComponent.js';
import EventBusComponent from '../components/EventBusComponent.js';
import { getEngineState } from './EngineState.js';

/**
 * Interface representing an abstract class constructor.
 */
export interface AbstractConstructor<T> {
  prototype: T;
  name: string;
}

/**
 * Base class for all entities in the game world.
 */
export default abstract class GameObject {
  /** Unique identifier for the game object. */
  public readonly id: string = Math.random().toString(36).substring(2, 9);
  private _components: Map<string, Component> = new Map();

  /**
   * The transform component for this object, managing position and scale.
   */
  public get transform(): TransformComponent {
    let transform = this.getComponent(TransformComponent);
    if (!transform) {
      transform = new TransformComponent();
      this.addComponent(transform);
    }
    return transform;
  }

  /**
   * The tag component for this object, managing its name and rendering order.
   */
  public get metadata(): TagComponent {
    let tag = this.getComponent(TagComponent);
    if (!tag) {
      tag = new TagComponent();
      this.addComponent(tag);
    }
    return tag;
  }

  /**
   * The bounds component for this object, defining its physical area.
   */
  public get bounds(): BoundsComponent | undefined {
    return this.getComponent(BoundsComponent);
  }

  /**
   * Sets the bounds component for this object.
   */
  public set bounds(val: BoundsComponent | undefined) {
    if (val) {
      this.addComponent(val);
    } else {
      this.removeComponent(BoundsComponent);
    }
  }

  /**
   * initialises a new instance of a GameObject.
   * @param tag A descriptive name for the object.
   * @param zIndex The rendering order (higher numbers are drawn on top).
   * @param sourceId Hidden identifier linking runtime object to its source code location.
   */
  constructor(tag: string = 'obj', zIndex: number = 0, sourceId?: string) {
    this.addComponent(new TagComponent(tag, zIndex, sourceId));
    this.addComponent(new TransformComponent());
    getEngineState()?.objectCreationObservers?.events.dispatchEvent(new CustomEvent('created', { detail: this }));
  }

  /**
   * Listens for an event on this object's event bus.
   * @param type The event type.
   * @param callback The function to run when the event occurs.
   */
  public on(type: string, callback: (event: CustomEvent) => void) {
    let bus = this.getComponent(EventBusComponent);
    if (!bus) {
      bus = new EventBusComponent();
      this.addComponent(bus);
    }
    bus.on(type, callback);
  }

  /**
   * Stops listening for an event on this object's event bus.
   * @param type The event type.
   * @param callback The function to remove.
   */
  public off(type: string, callback: (event: CustomEvent) => void) {
    this.getComponent(EventBusComponent)?.off(type, callback);
  }

  /**
   * Emits a custom event on this object's event bus.
   * @param type The event type.
   * @param detail Optional data to pass with the event.
   */
  public emit(type: string, detail?: unknown) {
    this.getComponent(EventBusComponent)?.emit(type, detail);
  }

  /**
   * Adds a component to this game object.
   * @param component The component instance to add.
   */
  public addComponent(component: Component) {
    component.gameObject = this;
    let proto = Object.getPrototypeOf(component);
    while (proto && proto.constructor.name !== 'Object') {
      const key = proto.constructor.name;
      this._components.set(key, component);
      if (key === 'Component') break;
      proto = Object.getPrototypeOf(proto);
    }
    component.onAttach?.();
  }

  /**
   * Removes a component from this game object by its class.
   * @param componentClass The class of the component to remove.
   */
  public removeComponent<T extends Component>(componentClass: AbstractConstructor<T>) {
    const component = this.getComponent(componentClass);
    if (!component) return;
    for (const [key, value] of this._components.entries()) {
      if (value === component) {
        this._components.delete(key);
      }
    }
  }

  /**
   * Checks if this object has a component of the specified class.
   * @param componentClass The class to check for.
   * @returns True if the component exists.
   */
  public hasComponent<T extends Component>(componentClass: AbstractConstructor<T>): boolean {
    return this._components.has(componentClass.name);
  }

  /**
   * Retrieves a component from this object by its class.
   * @param componentClass The class of the component to retrieve.
   * @returns The component instance, or undefined if not found.
   */
  public getComponent<T extends Component>(componentClass: AbstractConstructor<T>): T | undefined {
    return this._components.get(componentClass.name) as T;
  }

  /**
   * Registers this object with the active scene or global engine loop.
   */
  public registerSelf() {
    Registry.registerObject(this);
  }

  /** Static helper for tests to bypass Registry circularity if mocked. */
  static _registry = Registry;

  /**
   * Removes this object from the active scene or global engine loop.
   */
  public destroySelf() {
    GameObject._registry.destroyObject(this);
  }
}
